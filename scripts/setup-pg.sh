#!/usr/bin/env bash
# DEPRECATED: Do not run scripts that alter system pg_hba.conf or enable 0.0.0.0/0 trust authentication.
# Tests and local services must use dedicated, authenticated PostgreSQL databases provisioned safely by the operator.
echo "ERROR: scripts/setup-pg.sh has been disabled for security reasons."
echo "Please provision your test database with standard authenticated credentials (e.g. DATABASE_URL) instead."
exit 1
