# Debian VM Deployment Guide - Elyra Core

This guide outlines the steps to deploy Elyra Core on a Debian VM, specifically focusing on the `email-io` service and database infrastructure.

## 1. Infrastructure Requirements

The following services must be available (either on the same VM or accessible via network):

- **PostgreSQL 16**: Standard database for core data.
- **MinIO**: S3-compatible storage for assets.
- **Node.js 18+**: Required for the frontend and backends.
- **Python 3**: Required for the `gog` tool.

> [!NOTE]
> Based on the local infrastructure audit, **Redis is not required** for the current version of Elyra Core.

## 2. Environment Configuration

### email-io Service
Create a `.env` file in the `email-io` directory with the following variables:

```bash
PORT=3001
INTERNAL_API_KEY=your_secure_internal_key
GOG_ACCOUNT=elly@elyra-core.app
```

### Main Worker / Frontend
Ensure `INTERNAL_API_KEY` matches across all services to allow communication.

## 3. Gog Tool Sync

The `email-io` service now uses the `gog` Python CLI tool for Gmail operations.

1.  Ensure `gog` is installed and in the system `PATH`.
2.  Authorize the account:
    ```bash
    gog auth --account elly@elyra-core.app
    ```
3.  The service will automatically call `gog gmail ...` to process requests.

## 4. Starting the Services

You can use the provided restart script (if modified for VM paths) or start the service manually:

```bash
cd email-io
npm run start
```

## 5. Database Setup

Follow the steps in [LOCAL_POSTGRES_MINIO_SETUP.md](../LOCAL_POSTGRES_MINIO_SETUP.md) for initial schema migration and seeding, replacing `127.0.0.1` with the VM's internal IP if necessary.
