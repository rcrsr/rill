import { describe, it, expect } from 'vitest';
import { generateAgentCard } from '../src/card.js';
import type { AgentManifest } from '../src/schema.js';

// ============================================================
// HELPERS
// ============================================================

const MINIMAL_MANIFEST: AgentManifest = {
  name: 'test-agent',
  version: '1.0.0',
  runtime: '@rcrsr/rill@^0.8.0',
  entry: 'src/main.rill',
  modules: {},
  extensions: {},
  functions: {},
  assets: [],
  skills: [],
};

// ============================================================
// GENERATE AGENT CARD
// ============================================================

describe('generateAgentCard', () => {
  // ============================================================
  // CAPABILITIES [AC-1]
  // ============================================================

  describe('capabilities [AC-1]', () => {
    it('sets streaming to false for any manifest', () => {
      const card = generateAgentCard(MINIMAL_MANIFEST);
      expect(card.capabilities.streaming).toBe(false);
    });

    it('sets pushNotifications to false for any manifest', () => {
      const card = generateAgentCard(MINIMAL_MANIFEST);
      expect(card.capabilities.pushNotifications).toBe(false);
    });

    it('returns capabilities object with exactly streaming and pushNotifications', () => {
      const card = generateAgentCard(MINIMAL_MANIFEST);
      expect(card.capabilities).toEqual({
        streaming: false,
        pushNotifications: false,
      });
    });
  });

  // ============================================================
  // SKILLS [AC-2, AC-3, AC-25, AC-26]
  // ============================================================

  describe('skills [AC-2, AC-3, AC-25, AC-26]', () => {
    it('equals manifest.skills verbatim when skills are present [AC-2]', () => {
      const skills = [
        {
          id: 'summarize',
          name: 'Summarize',
          description: 'Summarizes text',
          tags: ['text', 'nlp'],
          examples: ['Summarize this article'],
          inputModes: ['text/plain'],
          outputModes: ['text/plain'],
        },
      ];
      const manifest: AgentManifest = { ...MINIMAL_MANIFEST, skills };
      const card = generateAgentCard(manifest);
      expect(card.skills).toEqual(skills);
    });

    it('equals [] when manifest.skills is an empty array [AC-3]', () => {
      const manifest: AgentManifest = { ...MINIMAL_MANIFEST, skills: [] };
      const card = generateAgentCard(manifest);
      expect(card.skills).toEqual([]);
    });

    it('passes through a skill with all optional fields unmodified [AC-25]', () => {
      const skill = {
        id: 'classify',
        name: 'Classify',
        description: 'Classifies content',
        tags: ['ml', 'classification'],
        examples: ['Classify this text', 'Label this document'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      };
      const manifest: AgentManifest = { ...MINIMAL_MANIFEST, skills: [skill] };
      const card = generateAgentCard(manifest);
      expect(card.skills[0]).toEqual(skill);
    });

    it('passes through a skill with only required fields [AC-26]', () => {
      const skill = {
        id: 'translate',
        name: 'Translate',
        description: 'Translates text between languages',
      };
      const manifest: AgentManifest = { ...MINIMAL_MANIFEST, skills: [skill] };
      const card = generateAgentCard(manifest);
      expect(card.skills[0]).toEqual(skill);
      expect(card.skills[0]).not.toHaveProperty('tags');
      expect(card.skills[0]).not.toHaveProperty('examples');
      expect(card.skills[0]).not.toHaveProperty('inputModes');
      expect(card.skills[0]).not.toHaveProperty('outputModes');
    });

    it('preserves multiple skills in order', () => {
      const skills = [
        { id: 'a', name: 'Alpha', description: 'First skill' },
        { id: 'b', name: 'Beta', description: 'Second skill' },
      ];
      const manifest: AgentManifest = { ...MINIMAL_MANIFEST, skills };
      const card = generateAgentCard(manifest);
      expect(card.skills).toHaveLength(2);
      expect(card.skills[0]?.id).toBe('a');
      expect(card.skills[1]?.id).toBe('b');
    });
  });

  // ============================================================
  // URL [AC-4, AC-5, AC-27]
  // ============================================================

  describe('url [AC-4, AC-5, AC-27]', () => {
    it('equals "http://localhost:4000" when deploy.port is 4000 [AC-4]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        deploy: { port: 4000, healthPath: '/health' },
      };
      const card = generateAgentCard(manifest);
      expect(card.url).toBe('http://localhost:4000');
    });

    it('equals "" when deploy is absent [AC-5]', () => {
      const card = generateAgentCard(MINIMAL_MANIFEST);
      expect(card.url).toBe('');
    });

    it('equals "" when deploy is present but port is absent [AC-27]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        deploy: { healthPath: '/health' },
      };
      const card = generateAgentCard(manifest);
      expect(card.url).toBe('');
    });

    it('interpolates port correctly for port 3000', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        deploy: { port: 3000, healthPath: '/health' },
      };
      const card = generateAgentCard(manifest);
      expect(card.url).toBe('http://localhost:3000');
    });
  });

  // ============================================================
  // NAME AND VERSION [AC-6]
  // ============================================================

  describe('name and version [AC-6]', () => {
    it('equals manifest.name [AC-6]', () => {
      const manifest: AgentManifest = { ...MINIMAL_MANIFEST, name: 'my-agent' };
      const card = generateAgentCard(manifest);
      expect(card.name).toBe('my-agent');
    });

    it('equals manifest.version [AC-6]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        version: '2.5.1',
      };
      const card = generateAgentCard(manifest);
      expect(card.version).toBe('2.5.1');
    });
  });

  // ============================================================
  // DESCRIPTION [AC-7]
  // ============================================================

  describe('description [AC-7]', () => {
    it('equals manifest.description when present [AC-7]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        description: 'An agent that does things',
      };
      const card = generateAgentCard(manifest);
      expect(card.description).toBe('An agent that does things');
    });

    it('equals "" when manifest.description is absent [AC-7]', () => {
      const card = generateAgentCard(MINIMAL_MANIFEST);
      expect(card.description).toBe('');
    });
  });

  // ============================================================
  // DEFAULT INPUT MODES [AC-8]
  // ============================================================

  describe('defaultInputModes [AC-8]', () => {
    it('equals ["application/json"] [AC-8]', () => {
      const card = generateAgentCard(MINIMAL_MANIFEST);
      expect(card.defaultInputModes).toEqual(['application/json']);
    });
  });

  // ============================================================
  // DEFAULT OUTPUT MODES [AC-9]
  // ============================================================

  describe('defaultOutputModes [AC-9]', () => {
    it('equals ["application/json"] [AC-9]', () => {
      const card = generateAgentCard(MINIMAL_MANIFEST);
      expect(card.defaultOutputModes).toEqual(['application/json']);
    });
  });

  // ============================================================
  // MINIMAL MANIFEST [AC-10]
  // ============================================================

  describe('minimal manifest [AC-10]', () => {
    it('returns a valid AgentCard from a minimal manifest [AC-10]', () => {
      const card = generateAgentCard(MINIMAL_MANIFEST);
      expect(card).toMatchObject({
        name: 'test-agent',
        version: '1.0.0',
        description: '',
        url: '',
        capabilities: { streaming: false, pushNotifications: false },
        skills: [],
        defaultInputModes: ['application/json'],
        defaultOutputModes: ['application/json'],
      });
    });
  });

  // ============================================================
  // NO EXTENSION DATA IN CARD [AC-28]
  // ============================================================

  describe('no extension data in card [AC-28]', () => {
    it('card contains no extension namespace information [AC-28]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        extensions: {
          llm: {
            package: '@vendor/llm',
            config: { model: 'gpt-4' },
          },
        },
      };
      const card = generateAgentCard(manifest);

      expect(card).not.toHaveProperty('extensions');
      expect(card).not.toHaveProperty('namespaces');
      expect(card).not.toHaveProperty('functions');
      expect(JSON.stringify(card)).not.toContain('llm');
      expect(JSON.stringify(card)).not.toContain('gpt-4');
    });

    it('card shape contains only the base A2A fields when no input/output in manifest', () => {
      const card = generateAgentCard(MINIMAL_MANIFEST);
      const keys = Object.keys(card).sort();
      expect(keys).toEqual([
        'capabilities',
        'defaultInputModes',
        'defaultOutputModes',
        'description',
        'name',
        'skills',
        'url',
        'version',
      ]);
    });
  });

  // ============================================================
  // INPUT / OUTPUT IN CARD [AC-2, AC-3, EC-7]
  // ============================================================

  describe('input and output fields in card [AC-2, AC-3, EC-7]', () => {
    // AC-2: card includes input and output when manifest declares them
    it('includes input field when manifest declares input [AC-2]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        input: {
          query: { type: 'string', required: true },
          limit: { type: 'number' },
        },
      };
      const card = generateAgentCard(manifest);
      expect(card).toHaveProperty('input');
      expect(card.input?.['query']?.type).toBe('string');
      expect(card.input?.['limit']?.type).toBe('number');
    });

    it('includes output field when manifest declares output [AC-2]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        output: { type: 'dict', description: 'Result' },
      };
      const card = generateAgentCard(manifest);
      expect(card).toHaveProperty('output');
      expect(card.output?.type).toBe('dict');
    });

    it('includes both input and output when manifest declares both [AC-2]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        input: { score: { type: 'number', required: true } },
        output: { type: 'string' },
      };
      const card = generateAgentCard(manifest);
      expect(card).toHaveProperty('input');
      expect(card).toHaveProperty('output');
    });

    // AC-3: card OMITS input/output when manifest omits them (no undefined key)
    it('does not set input key at all when manifest omits input [AC-3]', () => {
      const card = generateAgentCard(MINIMAL_MANIFEST);
      expect(Object.prototype.hasOwnProperty.call(card, 'input')).toBe(false);
    });

    it('does not set output key at all when manifest omits output [AC-3]', () => {
      const card = generateAgentCard(MINIMAL_MANIFEST);
      expect(Object.prototype.hasOwnProperty.call(card, 'output')).toBe(false);
    });

    it('card keys include input and output when both declared', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        input: { q: { type: 'string' } },
        output: { type: 'number' },
      };
      const card = generateAgentCard(manifest);
      const keys = Object.keys(card).sort();
      expect(keys).toContain('input');
      expect(keys).toContain('output');
    });

    // EC-7: does not throw for any valid manifest
    it('does not throw for manifest with input only [EC-7]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        input: { q: { type: 'string' } },
      };
      expect(() => generateAgentCard(manifest)).not.toThrow();
    });

    it('does not throw for manifest with output only [EC-7]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        output: { type: 'list' },
      };
      expect(() => generateAgentCard(manifest)).not.toThrow();
    });

    it('does not throw for manifest with both input and output [EC-7]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        input: { x: { type: 'bool', required: true } },
        output: {
          type: 'dict',
          fields: { result: { type: 'string' } },
        },
      };
      expect(() => generateAgentCard(manifest)).not.toThrow();
    });
  });

  // ============================================================
  // ERROR HANDLING [EC-1]
  // ============================================================

  describe('error handling and purity [EC-1]', () => {
    it('does not throw for a valid manifest [EC-1]', () => {
      expect(() => generateAgentCard(MINIMAL_MANIFEST)).not.toThrow();
    });

    it('returns the same output for the same inputs (determinism) [EC-1]', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        description: 'Deterministic agent',
        skills: [
          { id: 's1', name: 'Skill One', description: 'Does something' },
        ],
        deploy: { port: 8080, healthPath: '/health' },
      };

      const card1 = generateAgentCard(manifest);
      const card2 = generateAgentCard(manifest);

      expect(card1).toEqual(card2);
    });

    it('does not mutate the input manifest', () => {
      const manifest: AgentManifest = {
        ...MINIMAL_MANIFEST,
        skills: [{ id: 'x', name: 'X', description: 'Skill X' }],
      };
      const originalSkillCount = manifest.skills.length;
      generateAgentCard(manifest);
      expect(manifest.skills).toHaveLength(originalSkillCount);
      expect(manifest.name).toBe('test-agent');
    });
  });
});
