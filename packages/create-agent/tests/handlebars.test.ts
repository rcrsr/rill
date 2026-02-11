import { describe, it, expect } from 'vitest';
import Handlebars from 'handlebars';

describe('Handlebars Integration', () => {
  it('can compile and render templates', () => {
    const template = Handlebars.compile('Hello {{name}}!');
    const result = template({ name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('supports nested properties', () => {
    const template = Handlebars.compile('{{user.name}} - {{user.email}}');
    const result = template({
      user: { name: 'John', email: 'john@example.com' },
    });
    expect(result).toBe('John - john@example.com');
  });
});
