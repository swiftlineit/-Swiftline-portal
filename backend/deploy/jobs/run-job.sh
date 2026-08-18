#!/usr/bin/env bash
#
# Runs one Swiftline maintenance job on behalf of cron.
#
# Cron is a hostile environment for a Node app and every one of the guards below
# exists because of a specific way these jobs fail without it:
#
#   * cron's PATH is roughly `/usr/bin:/bin`, so `node` and `npm` are usually not
#     on it at all- especially under nvm. Hence the explicit PATH handling.
#   * the app reads its `.env` through `dotenv/config`, which resolves relative
#     to the working directory. cron starts in the user's home, so without the
#     `cd` below the process exits complaining about MONGODB_URI.
#   * the email drain and reservation sweep run every five minutes. If one run is
#     slow, the next would start on top of it and the two would fight over the
#     same rows. `flock` makes a run skip rather than stack.
#   * cron discards stdout unless a mail transport is configured, which is how a
#     job that has been failing for a month goes unnoticed. Everything is
#     appended to a log, and failures additionally land in one shared file that
#     is cheap to watch.
#
# Usage:  run-job.sh <npm-script-name>
# Example: run-job.sh job:email:drain

set -uo pipefail

JOB_NAME="${1:-}"

if [ -z "$JOB_NAME" ]; then
  echo "usage: run-job.sh <npm-script-name>" >&2
  exit 2
fi

# Operators override these in /etc/swiftline/jobs.env rather than editing this file.
CONFIG_FILE="${SWIFTLINE_JOBS_CONFIG:-/etc/swiftline/jobs.env}"
if [ -r "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
fi

APP_DIR="${SWIFTLINE_APP_DIR:-/var/www/Swiftline-portal/backend}"
LOG_DIR="${SWIFTLINE_LOG_DIR:-/var/log/swiftline}"
LOCK_DIR="${SWIFTLINE_LOCK_DIR:-/var/lock}"
NODE_BIN_DIR="${SWIFTLINE_NODE_BIN_DIR:-}"

# Colons are legal in filenames but awkward in log paths and lock names.
JOB_SLUG="$(printf '%s' "$JOB_NAME" | tr ':' '-')"
JOB_LOG="${LOG_DIR}/${JOB_SLUG}.log"
FAILURE_LOG="${LOG_DIR}/failures.log"
LOCK_FILE="${LOCK_DIR}/swiftline-${JOB_SLUG}.lock"

if [ -n "$NODE_BIN_DIR" ]; then
  PATH="${NODE_BIN_DIR}:${PATH}"
fi
export PATH

timestamp() { date --iso-8601=seconds; }

log() { printf '%s  %s\n' "$(timestamp)" "$1" >>"$JOB_LOG"; }

mkdir -p "$LOG_DIR" || {
  echo "run-job.sh: cannot create log directory $LOG_DIR" >&2
  exit 1
}

if ! command -v npm >/dev/null 2>&1; then
  # Written to the failure log too: without npm nothing below can report anything.
  printf '%s  %s  npm not found on PATH (%s). Set SWIFTLINE_NODE_BIN_DIR in %s.\n' \
    "$(timestamp)" "$JOB_NAME" "$PATH" "$CONFIG_FILE" >>"$FAILURE_LOG"
  log "ABORTED  npm not found on PATH: $PATH"
  exit 127
fi

if [ ! -d "$APP_DIR" ]; then
  printf '%s  %s  application directory not found: %s\n' \
    "$(timestamp)" "$JOB_NAME" "$APP_DIR" >>"$FAILURE_LOG"
  log "ABORTED  application directory not found: $APP_DIR"
  exit 1
fi

cd "$APP_DIR" || {
  log "ABORTED  could not enter $APP_DIR"
  exit 1
}

# `-n` means "give up rather than queue". A skipped run is harmless: every one of
# these jobs is idempotent and the next tick picks up whatever was missed.
#
# The availability check matters more than it looks. `flock` is part of
# util-linux and is present on Amazon Linux and Ubuntu, but if it were ever
# missing, an unguarded `if ! flock -n 9` would be true on every single run- so
# every job would log "SKIPPED" and exit 0, for ever, looking perfectly healthy.
# That is the exact failure this whole file exists to prevent, so it degrades to
# running without the lock and says so, rather than silently doing nothing.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE" || {
    log "ABORTED  could not open lock file $LOCK_FILE"
    exit 1
  }

  if ! flock -n 9; then
    log "SKIPPED  previous run still in progress"
    exit 0
  fi
else
  log "WARNING  flock unavailable; running without overlap protection"
fi

STARTED_AT=$(date +%s)
log "START"

# stdbuf keeps the job's own progress lines interleaved in real time rather than
# arriving in one block when the process exits.
if command -v stdbuf >/dev/null 2>&1; then
  stdbuf -oL -eL npm run --silent "$JOB_NAME" >>"$JOB_LOG" 2>&1
else
  npm run --silent "$JOB_NAME" >>"$JOB_LOG" 2>&1
fi
EXIT_CODE=$?

DURATION=$(( $(date +%s) - STARTED_AT ))

if [ "$EXIT_CODE" -eq 0 ]; then
  log "OK  finished in ${DURATION}s"
else
  log "FAILED  exit ${EXIT_CODE} after ${DURATION}s"
  # One shared file so a single `tail` covers every job. The per-job log holds
  # the actual output; this is the thing to alert on.
  printf '%s  %s  exit %s after %ss  (see %s)\n' \
    "$(timestamp)" "$JOB_NAME" "$EXIT_CODE" "$DURATION" "$JOB_LOG" >>"$FAILURE_LOG"
fi

exit "$EXIT_CODE"
