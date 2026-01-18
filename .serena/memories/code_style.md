# Code Style and Conventions

## TypeScript Configuration
- **Target**: ES2022
- **Module**: NodeNext (ESM)
- **Strict mode**: Enabled with additional checks
  - `noUncheckedIndexedAccess`: true
  - `exactOptionalPropertyTypes`: true
  - `noImplicitReturns`: true
  - `noFallthroughCasesInSwitch`: true

## Prettier Settings
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 80
}
```

## ESLint Rules
- TypeScript recommended rules enabled
- Unused variables allowed if prefixed with underscore (`_`)
- Explicit return types not required
- `any` type produces warning (not error)

## Code Conventions
1. **Imports**: Use `.js` extension for local imports (ESM requirement)
2. **Comments**: JSDoc-style block comments for public functions
3. **Naming**: 
   - camelCase for variables and functions
   - PascalCase for types, interfaces, and classes
   - SCREAMING_SNAKE_CASE for constants
4. **Error handling**: Custom error classes extend `RillError`
5. **Type definitions**: Prefer interfaces for object shapes, type aliases for unions

## File Organization
- One concept per file
- Export public API from index.ts files
- Keep related types near their implementation
