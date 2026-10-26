#!/bin/sh
# Stands in for a real build: packages a shell script as the program, so the
# pipeline can be exercised on any host. Prints the archive path last.
set -eu
archive=native-fixture-0.1.0-darwin-arm64.tar.gz
program=native-fixture/native-fixture
mode=755
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/target/package"
rm -rf "$out"
mkdir -p "$out/$(dirname "$program")"
cat > "$out/$program" <<'PROG'
#!/bin/sh
case "${1:-}" in
  --version) echo "native-fixture 0.1.0" ;;
  *) echo "hello" ;;
esac
PROG
chmod "$mode" "$out/$program"
tar -czf "$out/$archive" -C "$out" native-fixture
echo "$out/$archive"
