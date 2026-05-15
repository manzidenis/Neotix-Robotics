from __future__ import annotations

import io
import os
import shutil
import tempfile
import zipfile
import uuid
from collections import OrderedDict
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Iterator
from urllib.parse import urlparse

from api.config import settings


def _temp_root() -> Path:
    settings.TEMP_WORK_PATH.mkdir(parents=True, exist_ok=True)
    return settings.TEMP_WORK_PATH


def r2_enabled() -> bool:
    return all([
        settings.R2_ACCOUNT_ID,
        settings.R2_ACCESS_KEY_ID,
        settings.R2_SECRET_ACCESS_KEY,
        settings.R2_BUCKET,
    ])


def is_r2_uri(path: str | os.PathLike[str]) -> bool:
    return str(path).startswith("r2://")


def _require_r2() -> None:
    if not r2_enabled():
        raise RuntimeError("R2 storage is not configured")


def get_r2_client():
    import boto3

    _require_r2()
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def _parse_r2_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "r2" or not parsed.netloc:
        raise ValueError(f"Invalid R2 URI: {uri}")
    key = parsed.path.lstrip("/")
    return parsed.netloc, key


def _key_join(base: str, *parts: str) -> str:
    base_path = PurePosixPath(base)
    for part in parts:
        if part:
            base_path /= PurePosixPath(part.replace("\\", "/"))
    return str(base_path)


def _safe_storage_name(value: str) -> str:
    cleaned = value.strip().replace("\\", "_").replace("/", "_")
    return cleaned or "dataset"


def dataset_root_uri(user_id: int | None, name: str) -> str:
    _require_r2()
    owner = str(user_id or "shared")
    prefix = _key_join(settings.R2_DATASET_PREFIX, owner, _safe_storage_name(name))
    return f"r2://{settings.R2_BUCKET}/{prefix}"


def replay_object_uri(user_id: int | None, episode_id: int) -> str:
    _require_r2()
    owner = str(user_id or "shared")
    key = _key_join(settings.R2_REPLAY_PREFIX, owner, f"episode_{episode_id}.mp4")
    return f"r2://{settings.R2_BUCKET}/{key}"


def upload_archive_uri(user_id: int | None, filename: str) -> str:
    _require_r2()
    owner = str(user_id or "shared")
    safe_name = _safe_storage_name(filename)
    key = _key_join(settings.R2_UPLOAD_PREFIX, owner, uuid.uuid4().hex, safe_name)
    return f"r2://{settings.R2_BUCKET}/{key}"


def join_uri(base_uri: str, relative_path: str | Path) -> str:
    bucket, key = _parse_r2_uri(base_uri)
    rel = str(relative_path).replace("\\", "/").lstrip("/")
    return f"r2://{bucket}/{_key_join(key, rel)}"


def object_exists(uri: str) -> bool:
    if not is_r2_uri(uri):
        return Path(uri).exists()
    from botocore.exceptions import ClientError

    client = get_r2_client()
    bucket, key = _parse_r2_uri(uri)
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def read_bytes(uri: str) -> bytes:
    if not is_r2_uri(uri):
        return Path(uri).read_bytes()
    client = get_r2_client()
    bucket, key = _parse_r2_uri(uri)
    obj = client.get_object(Bucket=bucket, Key=key)
    return obj["Body"].read()


def read_text(uri: str, encoding: str = "utf-8") -> str:
    return read_bytes(uri).decode(encoding)


def upload_file(local_path: Path, uri: str) -> None:
    if not is_r2_uri(uri):
        dest = Path(uri)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local_path, dest)
        return
    client = get_r2_client()
    bucket, key = _parse_r2_uri(uri)
    client.upload_file(str(local_path), bucket, key)


def upload_fileobj(fileobj: BinaryIO, uri: str) -> None:
    if not is_r2_uri(uri):
        dest = Path(uri)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as out:
            shutil.copyfileobj(fileobj, out, length=1024 * 1024)
        return

    client = get_r2_client()
    bucket, key = _parse_r2_uri(uri)
    client.upload_fileobj(fileobj, bucket, key)


def upload_directory(local_dir: Path, root_uri: str) -> None:
    if not is_r2_uri(root_uri):
        dest = Path(root_uri)
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(local_dir, dest)
        return

    client = get_r2_client()
    bucket, base_key = _parse_r2_uri(root_uri)
    for file_path in local_dir.rglob("*"):
        if not file_path.is_file():
            continue
        rel = file_path.relative_to(local_dir).as_posix()
        client.upload_file(str(file_path), bucket, _key_join(base_key, rel))


def download_file(uri: str, local_path: Path) -> None:
    if not is_r2_uri(uri):
        source = Path(uri)
        if not source.exists():
            raise FileNotFoundError(f"Missing file: {source}")
        local_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, local_path)
        return

    client = get_r2_client()
    bucket, key = _parse_r2_uri(uri)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    client.download_file(bucket, key, str(local_path))


def delete_object(uri: str) -> None:
    if not is_r2_uri(uri):
        path = Path(uri)
        if path.exists():
            path.unlink()
        return
    client = get_r2_client()
    bucket, key = _parse_r2_uri(uri)
    client.delete_object(Bucket=bucket, Key=key)


def delete_prefix(root_uri: str) -> None:
    if not is_r2_uri(root_uri):
        return
    client = get_r2_client()
    bucket, base_key = _parse_r2_uri(root_uri)
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=base_key.rstrip("/") + "/"):
        objects = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
        for chunk_start in range(0, len(objects), 1000):
            chunk = objects[chunk_start:chunk_start + 1000]
            if chunk:
                client.delete_objects(Bucket=bucket, Delete={"Objects": chunk})


def create_multipart_upload(uri: str, content_type: str = "application/octet-stream") -> str:
    if not is_r2_uri(uri):
        raise ValueError("Multipart upload is only supported for R2 URIs")
    client = get_r2_client()
    bucket, key = _parse_r2_uri(uri)
    result = client.create_multipart_upload(Bucket=bucket, Key=key, ContentType=content_type)
    return result["UploadId"]


def presign_upload_part(uri: str, upload_id: str, part_number: int, expires_in: int | None = None) -> str:
    if not is_r2_uri(uri):
        raise ValueError("Multipart upload is only supported for R2 URIs")
    client = get_r2_client()
    bucket, key = _parse_r2_uri(uri)
    return client.generate_presigned_url(
        "upload_part",
        Params={
            "Bucket": bucket,
            "Key": key,
            "UploadId": upload_id,
            "PartNumber": part_number,
        },
        ExpiresIn=expires_in or settings.R2_SIGNED_URL_TTL_SECONDS,
    )


def complete_multipart_upload(uri: str, upload_id: str, parts: list[dict[str, int | str]]) -> None:
    if not is_r2_uri(uri):
        raise ValueError("Multipart upload is only supported for R2 URIs")
    client = get_r2_client()
    bucket, key = _parse_r2_uri(uri)
    client.complete_multipart_upload(
        Bucket=bucket,
        Key=key,
        UploadId=upload_id,
        MultipartUpload={
            "Parts": [
                {"PartNumber": int(part["PartNumber"]), "ETag": str(part["ETag"])}
                for part in sorted(parts, key=lambda item: int(item["PartNumber"]))
            ]
        },
    )


def abort_multipart_upload(uri: str, upload_id: str) -> None:
    if not is_r2_uri(uri):
        raise ValueError("Multipart upload is only supported for R2 URIs")
    client = get_r2_client()
    bucket, key = _parse_r2_uri(uri)
    client.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)


def presigned_url(uri: str, expires_in: int | None = None) -> str:
    if not is_r2_uri(uri):
        return str(Path(uri))
    client = get_r2_client()
    bucket, key = _parse_r2_uri(uri)
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in or settings.R2_SIGNED_URL_TTL_SECONDS,
    )


class _R2SeekableReader(io.RawIOBase):
    def __init__(self, uri: str, chunk_size: int = 8 * 1024 * 1024, max_cached_chunks: int = 8):
        if not is_r2_uri(uri):
            raise ValueError("Seekable R2 reader requires an R2 URI")
        self._client = get_r2_client()
        self._bucket, self._key = _parse_r2_uri(uri)
        metadata = self._client.head_object(Bucket=self._bucket, Key=self._key)
        self._size = int(metadata["ContentLength"])
        self._pos = 0
        self._chunk_size = max(1024 * 1024, chunk_size)
        self._max_cached_chunks = max(2, max_cached_chunks)
        self._cache: OrderedDict[int, bytes] = OrderedDict()
        self._closed = False

    def close(self) -> None:
        self._cache.clear()
        self._closed = True
        super().close()

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            new_pos = offset
        elif whence == io.SEEK_CUR:
            new_pos = self._pos + offset
        elif whence == io.SEEK_END:
            new_pos = self._size + offset
        else:
            raise ValueError(f"Unsupported whence: {whence}")

        self._pos = max(0, min(new_pos, self._size))
        return self._pos

    def read(self, size: int = -1) -> bytes:
        if self._closed:
            raise ValueError("I/O operation on closed file")
        if size is None or size < 0:
            size = self._size - self._pos
        if size <= 0 or self._pos >= self._size:
            return b""

        end_pos = min(self._size, self._pos + size)
        remaining = end_pos - self._pos
        cursor = self._pos
        chunks: list[bytes] = []

        while remaining > 0:
            chunk_index = cursor // self._chunk_size
            chunk = self._get_chunk(chunk_index)
            chunk_offset = cursor % self._chunk_size
            take = min(len(chunk) - chunk_offset, remaining)
            if take <= 0:
                break
            chunks.append(chunk[chunk_offset:chunk_offset + take])
            cursor += take
            remaining -= take

        self._pos = cursor
        return b"".join(chunks)

    def _get_chunk(self, chunk_index: int) -> bytes:
        cached = self._cache.get(chunk_index)
        if cached is not None:
            self._cache.move_to_end(chunk_index)
            return cached

        start = chunk_index * self._chunk_size
        end = min(self._size - 1, start + self._chunk_size - 1)
        response = self._client.get_object(
            Bucket=self._bucket,
            Key=self._key,
            Range=f"bytes={start}-{end}",
        )
        data = response["Body"].read()
        self._cache[chunk_index] = data
        self._cache.move_to_end(chunk_index)
        while len(self._cache) > self._max_cached_chunks:
            self._cache.popitem(last=False)
        return data


@contextmanager
def open_zip(uri: str) -> Iterator[zipfile.ZipFile]:
    if not is_r2_uri(uri):
        with zipfile.ZipFile(uri) as zf:
            yield zf
        return

    reader = _R2SeekableReader(uri)
    buffered = io.BufferedReader(reader, buffer_size=8 * 1024 * 1024)
    try:
        with zipfile.ZipFile(buffered) as zf:
            yield zf
    finally:
        buffered.close()


@contextmanager
def materialize_dataset(root_path: str | Path) -> Iterator[Path]:
    if not is_r2_uri(root_path):
        yield Path(root_path)
        return

    client = get_r2_client()
    bucket, base_key = _parse_r2_uri(str(root_path))
    tmp_dir = Path(tempfile.mkdtemp(prefix="neotix_r2_dataset_", dir=_temp_root()))
    try:
        paginator = client.get_paginator("list_objects_v2")
        found = False
        for page in paginator.paginate(Bucket=bucket, Prefix=base_key.rstrip("/") + "/"):
            for obj in page.get("Contents", []):
                found = True
                rel = obj["Key"][len(base_key.rstrip("/") + "/"):]
                dest = tmp_dir / Path(rel)
                dest.parent.mkdir(parents=True, exist_ok=True)
                client.download_file(bucket, obj["Key"], str(dest))
        if not found:
            raise FileNotFoundError(f"No objects found for dataset prefix: {root_path}")
        yield tmp_dir
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@contextmanager
def materialize_files(root_path: str | Path, relative_paths: list[str | Path]) -> Iterator[Path]:
    tmp_dir = Path(tempfile.mkdtemp(prefix="neotix_storage_files_", dir=_temp_root()))
    try:
        if is_r2_uri(root_path):
            client = get_r2_client()
            bucket, base_key = _parse_r2_uri(str(root_path))
            for rel in relative_paths:
                rel_path = Path(str(rel))
                target = tmp_dir / rel_path
                target.parent.mkdir(parents=True, exist_ok=True)
                key = _key_join(base_key, rel_path.as_posix())
                client.download_file(bucket, key, str(target))
        else:
            base = Path(root_path)
            for rel in relative_paths:
                rel_path = Path(str(rel))
                source = base / rel_path
                if not source.exists():
                    raise FileNotFoundError(f"Missing file: {source}")
                target = tmp_dir / rel_path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        yield tmp_dir
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
