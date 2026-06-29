set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

version="$1"

# Run from the repo root regardless of where the script is invoked from
cd "$(dirname "$0")/.."

if [ -d out ]; then
  rm -rf out
fi

if [ -f plyn-$version.vsix ]; then
  rm plyn-$version.vsix
fi

npx tsc
npx vsce package --allow-missing-repository

code --uninstall-extension plyn-$version.vsix || true
cursor --uninstall-extension plyn-$version.vsix || true

code --install-extension plyn-$version.vsix
cursor --install-extension plyn-$version.vsix