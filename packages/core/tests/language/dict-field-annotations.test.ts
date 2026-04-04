/**
 * Rill Language Tests: Dict Field Annotations
 * Tests for per-field ^(...) annotation syntax on dict, ordered, and tuple type constructors.
 */

import { describe, expect, it } from 'vitest';
import {
  parse,
  ParseError,
  type RillTypeValue,
  type RillFieldDef,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

// Helper to cast run() result to RillTypeValue for host-side inspection
async function runTypeValue(source: string): Promise<RillTypeValue> {
  return (await run(source)) as unknown as RillTypeValue;
}

describe('Dict Field Annotations', () => {
  // ============================================================
  // AC-1: dict annotation
  // ============================================================

  describe('AC-1: dict(^("label") name: string) parsed and evaluated', () => {
    it('parses dict field annotation at AST level', () => {
      const ast = parse('dict(^("label") name: string)');
      const stmt = ast.statements[0];
      expect(stmt?.type).toBe('Statement');
      if (stmt?.type === 'Statement' && stmt.expression.type === 'PipeChain') {
        const head = stmt.expression.head;
        if (head.type === 'TypeConstructor') {
          const field = head.args[0];
          expect(field?.name).toBe('name');
          expect(field?.annotations).toBeDefined();
          expect(field?.annotations).toHaveLength(1);
          expect(field?.annotations?.[0]?.type).toBe('NamedArg');
        }
      }
    });

    it('evaluates dict field with description annotation', async () => {
      const result = await runTypeValue('dict(^("label") name: string)');
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('dict');
      expect(result.structure.kind).toBe('dict');

      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.name).toBeDefined();
      expect(fields.name!.annotations).toEqual({ description: 'label' });
    });
  });

  // ============================================================
  // AC-2: ordered annotation
  // ============================================================

  describe('AC-2: ordered(^("label") name: string) parsed and evaluated', () => {
    it('parses ordered field annotation at AST level', () => {
      const ast = parse('ordered(^("label") name: string)');
      const stmt = ast.statements[0];
      expect(stmt?.type).toBe('Statement');
      if (stmt?.type === 'Statement' && stmt.expression.type === 'PipeChain') {
        const head = stmt.expression.head;
        if (head.type === 'TypeConstructor') {
          const field = head.args[0];
          expect(field?.name).toBe('name');
          expect(field?.annotations).toBeDefined();
          expect(field?.annotations).toHaveLength(1);
        }
      }
    });

    it('evaluates ordered field with description annotation', async () => {
      const result = await runTypeValue('ordered(^("label") name: string)');
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('ordered');
      expect(result.structure.kind).toBe('ordered');

      const fields = (result.structure as { fields: RillFieldDef[] }).fields;
      expect(fields).toHaveLength(1);
      expect(fields[0]!.name).toBe('name');
      expect(fields[0]!.annotations).toEqual({ description: 'label' });
    });
  });

  // ============================================================
  // AC-3: tuple annotation
  // ============================================================

  describe('AC-3: tuple(^("x") number, ^("y") number) positional fields carry annotations', () => {
    it('parses tuple positional field annotations at AST level', () => {
      const ast = parse('tuple(^("x") number, ^("y") number)');
      const stmt = ast.statements[0];
      expect(stmt?.type).toBe('Statement');
      if (stmt?.type === 'Statement' && stmt.expression.type === 'PipeChain') {
        const head = stmt.expression.head;
        if (head.type === 'TypeConstructor') {
          expect(head.args).toHaveLength(2);
          expect(head.args[0]?.annotations).toBeDefined();
          expect(head.args[0]?.annotations).toHaveLength(1);
          expect(head.args[1]?.annotations).toBeDefined();
          expect(head.args[1]?.annotations).toHaveLength(1);
        }
      }
    });

    it('evaluates tuple with annotations at indices 0 and 1', async () => {
      const result = await runTypeValue('tuple(^("x") number, ^("y") number)');
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('tuple');
      expect(result.structure.kind).toBe('tuple');

      const elements = (result.structure as { elements: RillFieldDef[] })
        .elements;
      expect(elements).toHaveLength(2);
      expect(elements[0]!.annotations).toEqual({ description: 'x' });
      expect(elements[1]!.annotations).toEqual({ description: 'y' });
    });
  });

  // ============================================================
  // AC-4: Multi-key annotations
  // ============================================================

  describe('AC-4: multi-key annotations accessible via .^type', () => {
    it('evaluates dict field with description and enum annotations', async () => {
      const result = await runTypeValue(
        'dict(^(description: "d", enum: "a,b") f: string)'
      );
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('dict');

      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.f).toBeDefined();
      expect(fields.f!.annotations).toEqual({ description: 'd', enum: 'a,b' });
    });

    it('accesses multi-key annotations via .^type in rill script', async () => {
      const script = `
        dict(^(description: "d", enum: "a,b") f: string) => $t
        $t
      `;
      const result = await runTypeValue(script);
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.f!.annotations).toHaveProperty('description', 'd');
      expect(fields.f!.annotations).toHaveProperty('enum', 'a,b');
    });
  });

  // ============================================================
  // AC-5: Unannotated field
  // ============================================================

  describe('AC-5: unannotated field has no annotations property', () => {
    it('dict(name: string) field has no annotations', async () => {
      const result = await runTypeValue('dict(name: string)');
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.name).toBeDefined();
      expect(fields.name!.annotations).toBeUndefined();
    });

    it('ordered(name: string) field has no annotations', async () => {
      const result = await runTypeValue('ordered(name: string)');
      const fields = (result.structure as { fields: RillFieldDef[] }).fields;
      expect(fields[0]!.annotations).toBeUndefined();
    });

    it('tuple(number, string) elements have no annotations', async () => {
      const result = await runTypeValue('tuple(number, string)');
      const elements = (result.structure as { elements: RillFieldDef[] })
        .elements;
      expect(elements[0]!.annotations).toBeUndefined();
      expect(elements[1]!.annotations).toBeUndefined();
    });
  });

  // ============================================================
  // AC-6: Host reads TypeStructure
  // ============================================================

  describe('AC-6: host reads fields[name].annotations from TypeStructure', () => {
    it('host reads dict field annotations from structure', async () => {
      const result = await runTypeValue(
        'dict(^("Full name") name: string, ^("User age") age: number)'
      );
      expect(result.__rill_type).toBe(true);
      expect(result.typeName).toBe('dict');
      expect(result.structure.kind).toBe('dict');

      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;

      // Verify name field
      expect(fields.name).toBeDefined();
      expect(fields.name!.type).toEqual({ kind: 'string' });
      expect(fields.name!.annotations).toEqual({ description: 'Full name' });

      // Verify age field
      expect(fields.age).toBeDefined();
      expect(fields.age!.type).toEqual({ kind: 'number' });
      expect(fields.age!.annotations).toEqual({ description: 'User age' });
    });

    it('host reads ordered field annotations from structure', async () => {
      const result = await runTypeValue(
        'ordered(^("First") a: string, ^("Second") b: number)'
      );
      const fields = (result.structure as { fields: RillFieldDef[] }).fields;
      expect(fields).toHaveLength(2);
      expect(fields[0]!.name).toBe('a');
      expect(fields[0]!.annotations).toEqual({ description: 'First' });
      expect(fields[1]!.name).toBe('b');
      expect(fields[1]!.annotations).toEqual({ description: 'Second' });
    });

    it('host reads tuple element annotations from structure', async () => {
      const result = await runTypeValue(
        'tuple(^(description: "x-coord", unit: "px") number, ^(description: "y-coord", unit: "px") number)'
      );
      const elements = (result.structure as { elements: RillFieldDef[] })
        .elements;
      expect(elements).toHaveLength(2);
      expect(elements[0]!.annotations).toEqual({
        description: 'x-coord',
        unit: 'px',
      });
      expect(elements[1]!.annotations).toEqual({
        description: 'y-coord',
        unit: 'px',
      });
    });

    it('host reads mixed annotated and unannotated fields', async () => {
      const result = await runTypeValue(
        'dict(^("labeled") name: string, age: number)'
      );
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;

      // Annotated field
      expect(fields.name!.annotations).toEqual({ description: 'labeled' });

      // Unannotated field
      expect(fields.age!.annotations).toBeUndefined();
    });
  });

  // ============================================================
  // AC-7: Host rill-ext schema builder contract
  // ============================================================

  describe('AC-7: host reads annotations.description from TypeStructure fields (rill-ext contract)', () => {
    it('structure.fields[name].annotations.description exists for annotated fields', async () => {
      const result = await runTypeValue(
        'dict(^("User name") name: string, ^("User age") age: number)'
      );
      expect(result.__rill_type).toBe(true);
      expect(result.structure.kind).toBe('dict');

      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;

      // rill-ext buildJsonSchemaFromStructuralType reads annotations['description']
      expect(fields.name!.annotations).toBeDefined();
      expect(fields.name!.annotations!['description']).toBe('User name');
      expect(fields.age!.annotations).toBeDefined();
      expect(fields.age!.annotations!['description']).toBe('User age');
    });

    it('structure.fields[name].annotations.enum exists for enum-annotated fields', async () => {
      const result = await runTypeValue(
        'dict(^(description: "status", enum: "active,inactive") status: string)'
      );
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;

      // rill-ext buildJsonSchemaFromStructuralType reads annotations['enum']
      expect(fields.status!.annotations).toBeDefined();
      expect(fields.status!.annotations!['description']).toBe('status');
      expect(fields.status!.annotations!['enum']).toBe('active,inactive');
    });

    it('unannotated fields have no annotations property for schema builder', async () => {
      const result = await runTypeValue(
        'dict(^("labeled") name: string, age: number)'
      );
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;

      // Schema builder skips fields without annotations
      expect(fields.name!.annotations).toBeDefined();
      expect(fields.name!.annotations!['description']).toBe('labeled');
      expect(fields.age!.annotations).toBeUndefined();
    });
  });

  // ============================================================
  // AC-8: Variable expression in annotation
  // ============================================================

  describe('AC-8: variable expression resolves in annotation value', () => {
    it('annotation value resolves to current variable value', async () => {
      const result = await runTypeValue(
        '"desc" => $x\ndict(^(description: $x) f: string)'
      );
      expect(result.__rill_type).toBe(true);
      expect(result.structure.kind).toBe('dict');

      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.f!.annotations).toEqual({ description: 'desc' });
    });

    it('annotation value resolves variable from earlier pipeline step', async () => {
      const result = await runTypeValue(
        '"hello" => $label\ndict(^(description: $label) greeting: string)'
      );
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.greeting!.annotations).toEqual({ description: 'hello' });
    });

    it('annotation value resolves computed expression with variable', async () => {
      const result = await runTypeValue(
        '10 => $max\ndict(^(limit: $max * 2) count: number)'
      );
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.count!.annotations).toEqual({ limit: 20 });
    });
  });

  // ============================================================
  // AC-9: Closure .^input forwards annotations
  // ============================================================

  describe('AC-9: closure .^input forwards annotations through paramToFieldDef', () => {
    it('closure ^input reflects description annotation on parameter', async () => {
      const result = await run(
        '|^("label") x: string|{ $x } => $fn\n$fn.^input'
      );
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: {
          kind: string;
          fields: {
            name: string;
            type: unknown;
            annotations?: Record<string, unknown>;
          }[];
        };
      };
      expect(shape.__rill_type).toBe(true);
      expect(shape.structure.kind).toBe('ordered');
      expect(shape.structure.fields).toHaveLength(1);
      expect(shape.structure.fields[0]!.name).toBe('x');
      expect(shape.structure.fields[0]!.type).toEqual({ kind: 'string' });
      expect(shape.structure.fields[0]!.annotations).toEqual({
        description: 'label',
      });
    });

    it('closure ^input reflects multi-key annotations on parameter', async () => {
      const result = await run(
        '|^(description: "name", min: 1) x: string|{ $x } => $fn\n$fn.^input'
      );
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: {
          kind: string;
          fields: {
            name: string;
            type: unknown;
            annotations?: Record<string, unknown>;
          }[];
        };
      };
      expect(shape.structure.fields[0]!.annotations).toEqual({
        description: 'name',
        min: 1,
      });
    });

    it('closure ^input omits annotations for unannotated parameters', async () => {
      const result = await run('|x: number|{ $x } => $fn\n$fn.^input');
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: {
          kind: string;
          fields: {
            name: string;
            type: unknown;
            annotations?: Record<string, unknown>;
          }[];
        };
      };
      expect(shape.structure.fields[0]!.name).toBe('x');
      expect(shape.structure.fields[0]!.annotations).toBeUndefined();
    });

    it('closure ^input forwards annotations on multiple parameters', async () => {
      const result = await run(
        '|^("first") a: string, ^("second") b: number|{ $a } => $fn\n$fn.^input'
      );
      const shape = result as {
        __rill_type: true;
        typeName: string;
        structure: {
          kind: string;
          fields: {
            name: string;
            type: unknown;
            annotations?: Record<string, unknown>;
          }[];
        };
      };
      expect(shape.structure.fields).toHaveLength(2);
      expect(shape.structure.fields[0]!.name).toBe('a');
      expect(shape.structure.fields[0]!.annotations).toEqual({
        description: 'first',
      });
      expect(shape.structure.fields[1]!.name).toBe('b');
      expect(shape.structure.fields[1]!.annotations).toEqual({
        description: 'second',
      });
    });
  });

  // ============================================================
  // EC-1: Parser errors (RILL-P014)
  // ============================================================

  describe('EC-1: parser errors for invalid annotation syntax', () => {
    it('AC-10: dict(^("x")) with no following field produces RILL-P014', () => {
      try {
        parse('dict(^("x"))');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.errorId).toBe('RILL-P014');
        expect(parseErr.message).toContain('Expected field after annotation');
      }
    });

    it('AC-11: unclosed ^( on dict field produces parse error', () => {
      try {
        parse('dict(^("label" name: string)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });

    it('AC-12: list(^("label") string) produces parse error', () => {
      try {
        parse('list(^("label") string)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });

    it('AC-14: malformed annotation key-value syntax produces parse error', () => {
      try {
        parse('dict(^(123) name: string)');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
      }
    });
  });

  // ============================================================
  // EC-2: Runtime errors (RILL-R002)
  // ============================================================

  describe('EC-2: runtime errors for annotation spread of non-dict', () => {
    it('AC-13: annotation spread of list value produces RILL-R002', async () => {
      const script = 'dict(^(...list[1, 2]) name: string)';
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R002');
    });

    it('AC-13: annotation spread of string value produces RILL-R002', async () => {
      const script = '"hello" => $x\ndict(^(...$x) name: string)';
      await expect(run(script)).rejects.toHaveProperty('errorId', 'RILL-R002');
    });

    it('AC-13: annotation spread error message mentions dict requirement', async () => {
      const script = 'dict(^(...list[1, 2]) name: string)';
      await expect(run(script)).rejects.toThrow(/Annotation spread requires/);
    });
  });

  // ============================================================
  // AC-15: Empty annotation
  // ============================================================

  describe('AC-15: empty annotation ^() produces empty annotations record', () => {
    it('dict(^() name: string) field carries empty annotations record', async () => {
      const result = await runTypeValue('dict(^() name: string)');
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.name).toBeDefined();
      expect(fields.name!.annotations).toEqual({});
    });

    it('ordered(^() name: string) field carries empty annotations record', async () => {
      const result = await runTypeValue('ordered(^() name: string)');
      const fields = (result.structure as { fields: RillFieldDef[] }).fields;
      expect(fields[0]!.annotations).toEqual({});
    });

    it('tuple(^() number, ^() string) elements carry empty annotations record', async () => {
      const result = await runTypeValue('tuple(^() number, ^() string)');
      const elements = (result.structure as { elements: RillFieldDef[] })
        .elements;
      expect(elements[0]!.annotations).toEqual({});
      expect(elements[1]!.annotations).toEqual({});
    });

    it('empty annotation differs from unannotated (no annotations property)', async () => {
      const result = await runTypeValue('dict(^() name: string, age: number)');
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      // ^() produces empty record
      expect(fields.name!.annotations).toEqual({});
      // unannotated field has no annotations property
      expect(fields.age!.annotations).toBeUndefined();
    });
  });

  // ============================================================
  // AC-16: Multiple annotation blocks
  // ============================================================

  describe('AC-16: multiple ^() blocks on one field merge into one map', () => {
    it('two annotation blocks merge on dict field', async () => {
      const result = await runTypeValue(
        'dict(^("label") ^(enum: "a,b") name: string)'
      );
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.name!.annotations).toEqual({
        description: 'label',
        enum: 'a,b',
      });
    });

    it('two annotation blocks merge on ordered field', async () => {
      const result = await runTypeValue(
        'ordered(^("desc") ^(min: 1) name: string)'
      );
      const fields = (result.structure as { fields: RillFieldDef[] }).fields;
      expect(fields[0]!.annotations).toEqual({
        description: 'desc',
        min: 1,
      });
    });

    it('two annotation blocks merge on tuple element', async () => {
      const result = await runTypeValue(
        'tuple(^("x-coord") ^(unit: "px") number, string)'
      );
      const elements = (result.structure as { elements: RillFieldDef[] })
        .elements;
      expect(elements[0]!.annotations).toEqual({
        description: 'x-coord',
        unit: 'px',
      });
    });

    it('three annotation blocks merge into one map', async () => {
      const result = await runTypeValue(
        'dict(^("label") ^(min: 0) ^(max: 100) score: number)'
      );
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.score!.annotations).toEqual({
        description: 'label',
        min: 0,
        max: 100,
      });
    });
  });

  // ============================================================
  // AC-18: Mix annotated and unannotated
  // ============================================================

  describe('AC-18: mix of annotated and unannotated fields', () => {
    it('only annotated fields carry annotations property in dict', async () => {
      const result = await runTypeValue(
        'dict(^("label") name: string, age: number)'
      );
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.name!.annotations).toEqual({ description: 'label' });
      expect(fields.age!.annotations).toBeUndefined();
    });

    it('only annotated fields carry annotations property in ordered', async () => {
      const result = await runTypeValue(
        'ordered(^("first") a: string, b: number, ^("third") c: bool)'
      );
      const fields = (result.structure as { fields: RillFieldDef[] }).fields;
      expect(fields[0]!.name).toBe('a');
      expect(fields[0]!.annotations).toEqual({ description: 'first' });
      expect(fields[1]!.name).toBe('b');
      expect(fields[1]!.annotations).toBeUndefined();
      expect(fields[2]!.name).toBe('c');
      expect(fields[2]!.annotations).toEqual({ description: 'third' });
    });

    it('only annotated elements carry annotations property in tuple', async () => {
      const result = await runTypeValue(
        'tuple(^("x") number, string, ^("z") bool)'
      );
      const elements = (result.structure as { elements: RillFieldDef[] })
        .elements;
      expect(elements[0]!.annotations).toEqual({ description: 'x' });
      expect(elements[1]!.annotations).toBeUndefined();
      expect(elements[2]!.annotations).toEqual({ description: 'z' });
    });
  });

  // ============================================================
  // AC-19: Complex expression annotation
  // ============================================================

  describe('AC-19: complex expression in annotation value evaluates to RillValue', () => {
    it('arithmetic expression evaluates in named annotation value', async () => {
      const result = await runTypeValue(
        'dict(^(description: 1 + 2) name: string)'
      );
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.name!.annotations).toEqual({ description: 3 });
    });

    it('multiplication expression evaluates in annotation value', async () => {
      const result = await runTypeValue('dict(^(limit: 5 * 20) name: string)');
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.name!.annotations).toEqual({ limit: 100 });
    });

    it('boolean expression evaluates in annotation value', async () => {
      const result = await runTypeValue(
        'dict(^(required: 1 == 1) name: string)'
      );
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.name!.annotations).toEqual({ required: true });
    });

    it('variable expression evaluates in annotation value', async () => {
      const result = await runTypeValue(
        '5 => $n\ndict(^(max: $n * 10) count: number)'
      );
      const fields = (
        result.structure as { fields: Record<string, RillFieldDef> }
      ).fields;
      expect(fields.count!.annotations).toEqual({ max: 50 });
    });
  });
});
