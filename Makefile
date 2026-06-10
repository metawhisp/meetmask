# MEETAMASK — dev shortcuts. The real logic lives in the scripts these call.
.PHONY: test-all generate

# Run the fast test suite (same entry point CI uses).
test-all:
	bash tests/run-all.sh

# Regenerate the Xcode project from project.yml (source of truth).
generate:
	xcodegen generate
