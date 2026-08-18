#!/usr/bin/env bash
#
# Installs the Swiftline scheduled jobs on an EC2 host.
#
# Idempotent: safe to re-run after a deploy or a path change. It only writes
# configuration- it never starts a job, so installing it cannot itself move
# money or send mail.
#
# Run as root:  sudo ./install.sh
#
# Override any of these before running if your layout differs:
#   SWIFTLINE_APP_DIR   where the backend lives      (default /var/www/Swiftline-portal/backend)
#   SWIFTLINE_USER      the account the API runs as  (default ubuntu)
#   SWIFTLINE_LOG_DIR   where job logs go            (default /var/log/swiftline)

set -euo pipefail

APP_DIR="${SWIFTLINE_APP_DIR:-/var/www/Swiftline-portal/backend}"
RUN_USER="${SWIFTLINE_USER:-ubuntu}"
LOG_DIR="${SWIFTLINE_LOG_DIR:-/var/log/swiftline}"
CONFIG_DIR="/etc/swiftline"
CONFIG_FILE="${CONFIG_DIR}/jobs.env"
CRON_FILE="/etc/cron.d/swiftline-jobs"
LOGROTATE_FILE="/etc/logrotate.d/swiftline-jobs"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "install.sh must run as root (try: sudo $0)" >&2
  exit 1
fi

if ! id "$RUN_USER" >/dev/null 2>&1; then
  echo "User '$RUN_USER' does not exist. Create it, or set SWIFTLINE_USER." >&2
  exit 1
fi

if [ ! -d "$APP_DIR" ]; then
  echo "Application directory '$APP_DIR' does not exist. Set SWIFTLINE_APP_DIR." >&2
  exit 1
fi

if [ ! -r "${APP_DIR}/.env" ]; then
  # Every job reads its configuration from this file via dotenv. Without it they
  # would each fail at startup on a missing MONGODB_URI.
  echo "No readable ${APP_DIR}/.env- the jobs cannot run without it." >&2
  exit 1
fi

echo "Installing Swiftline scheduled jobs"
echo "  application : $APP_DIR"
echo "  run as      : $RUN_USER"
echo "  logs        : $LOG_DIR"

install -d -o "$RUN_USER" -g "$RUN_USER" -m 0750 "$LOG_DIR"
install -d -m 0755 "$CONFIG_DIR"

# node is frequently outside cron's PATH, so the wrapper is told where to find
# it. Resolved from whatever is on PATH now, which is the shell that has already
# been used to install and run the app.
NODE_BIN_DIR="$(dirname "$(command -v node || true)")"
if [ -z "$NODE_BIN_DIR" ] || [ "$NODE_BIN_DIR" = "." ]; then
  echo "Could not locate 'node' on PATH. Set SWIFTLINE_NODE_BIN_DIR in $CONFIG_FILE by hand." >&2
  NODE_BIN_DIR=""
fi

cat >"$CONFIG_FILE" <<EOF
# Written by deploy/jobs/install.sh- edit here, not in run-job.sh.
SWIFTLINE_APP_DIR="${APP_DIR}"
SWIFTLINE_LOG_DIR="${LOG_DIR}"
SWIFTLINE_NODE_BIN_DIR="${NODE_BIN_DIR}"
EOF
chmod 0644 "$CONFIG_FILE"

chmod 0755 "${HERE}/run-job.sh"

# The cron file ships with the default paths and user baked in; rewrite them if
# this install is using anything else.
sed \
  -e "s#/var/www/Swiftline-portal/backend#${APP_DIR}#g" \
  -e "s#^\(\S\+ \+\S\+ \+\S\+ \+\S\+ \+\S\+\) \+ubuntu #\1  ${RUN_USER}  #" \
  "${HERE}/swiftline-jobs.cron" >"$CRON_FILE"
# cron ignores a file whose final line has no newline, and refuses one that is
# group- or world-writable.
[ -n "$(tail -c 1 "$CRON_FILE")" ] && echo >>"$CRON_FILE"
chown root:root "$CRON_FILE"
chmod 0644 "$CRON_FILE"

sed -e "s#/var/log/swiftline#${LOG_DIR}#g" \
    -e "s#ubuntu ubuntu#${RUN_USER} ${RUN_USER}#g" \
    "${HERE}/logrotate.conf" >"$LOGROTATE_FILE"
chmod 0644 "$LOGROTATE_FILE"

echo
echo "Installed:"
echo "  $CRON_FILE"
echo "  $CONFIG_FILE"
echo "  $LOGROTATE_FILE"
echo
echo "Verify with a single job before trusting the schedule:"
echo "  sudo -u ${RUN_USER} ${HERE}/run-job.sh job:credit:expire-reservations"
echo "  tail ${LOG_DIR}/job-credit-expire-reservations.log"
echo
echo "Then watch for failures across every job with:"
echo "  tail -f ${LOG_DIR}/failures.log"
