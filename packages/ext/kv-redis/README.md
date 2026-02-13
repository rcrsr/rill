# @rcrsr/rill-ext-kv-redis

Redis kv backend implementation for rill scripting language.

## Installation

```bash
npm install @rcrsr/rill-ext-kv-redis
```

## Usage

```typescript
import { createRedisKvExtension } from '@rcrsr/rill-ext-kv-redis';

const extension = createRedisKvExtension({
  url: 'redis://localhost:6379',
  mounts: {
    // Mount configurations
  },
  maxStoreSize: 1000000,
  writePolicy: 'dispose',
});
```

## Documentation

Full documentation available at [rill.run/docs/extensions/kv-redis/](https://rill.run/docs/extensions/kv-redis/)

## License

MIT
