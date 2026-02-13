# @rcrsr/rill-ext-fs-s3

S3 file system extension for rill.

Provides file system operations backed by S3-compatible storage (AWS S3, MinIO, etc.).

## Status

🚧 **Under Development** - Package scaffolding complete. Implementation in progress.

## Installation

```bash
pnpm add @rcrsr/rill-ext-fs-s3
```

## Development

```bash
# Install dependencies
pnpm install

# Build package
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint

# Full check
pnpm check
```

## Package Structure

```
packages/ext/fs-s3/
├── src/
│   ├── index.ts              # Public API exports
│   └── index.test.ts         # Smoke tests
├── dist/                     # Build output (generated)
├── package.json              # Package manifest
├── tsconfig.json             # TypeScript config (extends ../tsconfig.ext.json)
├── tsconfig.build.json       # Build-specific TypeScript config
├── tsup.config.ts            # Build configuration
├── vitest.config.ts          # Test configuration
└── dts-bundle-generator.config.cjs  # Type bundling configuration
```

## Dependencies

- **Production**: `@aws-sdk/client-s3` - AWS SDK for JavaScript v3 S3 client
- **Peer**: `@rcrsr/rill` - Core rill runtime

## License

MIT
