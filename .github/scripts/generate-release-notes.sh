#!/bin/bash

# Script to generate release notes from conventional commits
# Usage: ./generate-release-notes.sh

# Get the last tag or default to empty if none exists
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

if [ -z "$LAST_TAG" ]; then
  # If no tag exists, get all commits
  COMMITS=$(git log --pretty=format:"%s")
else
  # Get commits since last tag
  COMMITS=$(git log $LAST_TAG..HEAD --pretty=format:"%s")
fi

# Start building release notes
NOTES="## What's Changed\n\n"

# Process features
FEATURES=$(echo "$COMMITS" | grep -E "^feat(\([^)]+\))?:" || echo "")
if [ ! -z "$FEATURES" ]; then
  NOTES="$NOTES### Features\n\n"
  while IFS= read -r line; do
    # Extract the actual message after "feat: " or "feat(scope): "
    MESSAGE=$(echo "$line" | sed -E 's/^feat(\([^)]+\))?: //')
    NOTES="$NOTES- $MESSAGE\n"
  done <<< "$FEATURES"
  NOTES="$NOTES\n"
fi

# Process fixes
FIXES=$(echo "$COMMITS" | grep -E "^fix(\([^)]+\))?:" || echo "")
if [ ! -z "$FIXES" ]; then
  NOTES="$NOTES### Bug Fixes\n\n"
  while IFS= read -r line; do
    # Extract the actual message after "fix: " or "fix(scope): "
    MESSAGE=$(echo "$line" | sed -E 's/^fix(\([^)]+\))?: //')
    NOTES="$NOTES- $MESSAGE\n"
  done <<< "$FIXES"
  NOTES="$NOTES\n"
fi

# Process docs
DOCS=$(echo "$COMMITS" | grep -E "^docs(\([^)]+\))?:" || echo "")
if [ ! -z "$DOCS" ]; then
  NOTES="$NOTES### Documentation\n\n"
  while IFS= read -r line; do
    MESSAGE=$(echo "$line" | sed -E 's/^docs(\([^)]+\))?: //')
    NOTES="$NOTES- $MESSAGE\n"
  done <<< "$DOCS"
  NOTES="$NOTES\n"
fi

# Process refactoring
REFACTOR=$(echo "$COMMITS" | grep -E "^refactor(\([^)]+\))?:" || echo "")
if [ ! -z "$REFACTOR" ]; then
  NOTES="$NOTES### Code Refactoring\n\n"
  while IFS= read -r line; do
    MESSAGE=$(echo "$line" | sed -E 's/^refactor(\([^)]+\))?: //')
    NOTES="$NOTES- $MESSAGE\n"
  done <<< "$REFACTOR"
  NOTES="$NOTES\n"
fi

# Process chores (including version bumps)
CHORES=$(echo "$COMMITS" | grep -E "^chore(\([^)]+\))?:" || echo "")
if [ ! -z "$CHORES" ]; then
  NOTES="$NOTES### Miscellaneous\n\n"
  while IFS= read -r line; do
    MESSAGE=$(echo "$line" | sed -E 's/^chore(\([^)]+\))?: //')
    NOTES="$NOTES- $MESSAGE\n"
  done <<< "$CHORES"
  NOTES="$NOTES\n"
fi

# Process style changes
STYLES=$(echo "$COMMITS" | grep -E "^style(\([^)]+\))?:" || echo "")
if [ ! -z "$STYLES" ]; then
  NOTES="$NOTES### Style Changes\n\n"
  while IFS= read -r line; do
    MESSAGE=$(echo "$line" | sed -E 's/^style(\([^)]+\))?: //')
    NOTES="$NOTES- $MESSAGE\n"
  done <<< "$STYLES"
  NOTES="$NOTES\n"
fi

# Process performance improvements
PERF=$(echo "$COMMITS" | grep -E "^perf(\([^)]+\))?:" || echo "")
if [ ! -z "$PERF" ]; then
  NOTES="$NOTES### Performance Improvements\n\n"
  while IFS= read -r line; do
    MESSAGE=$(echo "$line" | sed -E 's/^perf(\([^)]+\))?: //')
    NOTES="$NOTES- $MESSAGE\n"
  done <<< "$PERF"
  NOTES="$NOTES\n"
fi

# Process tests
TESTS=$(echo "$COMMITS" | grep -E "^test(\([^)]+\))?:" || echo "")
if [ ! -z "$TESTS" ]; then
  NOTES="$NOTES### Tests\n\n"
  while IFS= read -r line; do
    MESSAGE=$(echo "$line" | sed -E 's/^test(\([^)]+\))?: //')
    NOTES="$NOTES- $MESSAGE\n"
  done <<< "$TESTS"
  NOTES="$NOTES\n"
fi

# Process build system changes
BUILD=$(echo "$COMMITS" | grep -E "^build(\([^)]+\))?:" || echo "")
if [ ! -z "$BUILD" ]; then
  NOTES="$NOTES### Build System\n\n"
  while IFS= read -r line; do
    MESSAGE=$(echo "$line" | sed -E 's/^build(\([^)]+\))?: //')
    NOTES="$NOTES- $MESSAGE\n"
  done <<< "$BUILD"
  NOTES="$NOTES\n"
fi

# Process CI changes
CI=$(echo "$COMMITS" | grep -E "^ci(\([^)]+\))?:" || echo "")
if [ ! -z "$CI" ]; then
  NOTES="$NOTES### CI/CD\n\n"
  while IFS= read -r line; do
    MESSAGE=$(echo "$line" | sed -E 's/^ci(\([^)]+\))?: //')
    NOTES="$NOTES- $MESSAGE\n"
  done <<< "$CI"
  NOTES="$NOTES\n"
fi

# Output the notes
echo -e "$NOTES"