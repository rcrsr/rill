import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../src/cli.js';
import * as scaffoldModule from '../src/scaffold.js';

// Mock modules
vi.mock('../src/scaffold.js', () => ({
  scaffold: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  checkbox: vi.fn(),
}));

describe('CLI Entry Point', () => {
  const mockScaffold = vi.mocked(scaffoldModule.scaffold);
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockScaffold.mockClear();
    mockScaffold.mockResolvedValue(undefined);
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  describe('IR-1: main(args: string[]): Promise<void>', () => {
    it('parses positional project name argument', async () => {
      await main(['my-project', '--extensions', 'anthropic']);

      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          projectName: 'my-project',
        })
      );
    });

    it('parses --extensions flag with comma-separated values', async () => {
      await main(['my-project', '--extensions', 'anthropic,openai']);

      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: ['anthropic', 'openai'],
        })
      );
    });

    it('parses --preset flag', async () => {
      await main(['my-project', '--preset', 'rag']);

      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: ['anthropic', 'qdrant'],
          starterPattern: 'search-focused',
        })
      );
    });

    it('parses --description flag', async () => {
      await main([
        'my-project',
        '--extensions',
        'anthropic',
        '--description',
        'My app',
      ]);

      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'My app',
        })
      );
    });

    it('parses --package-manager flag', async () => {
      await main([
        'my-project',
        '--extensions',
        'anthropic',
        '--package-manager',
        'pnpm',
      ]);

      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          packageManager: 'pnpm',
        })
      );
    });

    it('parses --no-install flag', async () => {
      await main(['my-project', '--extensions', 'anthropic', '--no-install']);

      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          installDeps: false,
        })
      );
    });

    it('parses --typescript flag', async () => {
      await main(['my-project', '--extensions', 'anthropic', '--typescript']);

      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          typescript: true,
        })
      );
    });

    it('calls scaffold with built ScaffoldConfig', async () => {
      await main([
        'my-project',
        '--extensions',
        'anthropic',
        '--description',
        'Test',
        '--package-manager',
        'yarn',
        '--typescript',
        '--no-install',
      ]);

      expect(mockScaffold).toHaveBeenCalledWith({
        projectName: 'my-project',
        extensions: ['anthropic'],
        description: 'Test',
        packageManager: 'yarn',
        typescript: true,
        installDeps: false,
        starterPattern: null,
      });
    });

    it('defaults to npm package manager when not specified', async () => {
      await main(['my-project', '--extensions', 'anthropic']);

      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          packageManager: 'npm',
        })
      );
    });

    it('defaults to installDeps true when --no-install not provided', async () => {
      await main(['my-project', '--extensions', 'anthropic']);

      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          installDeps: true,
        })
      );
    });

    it('defaults to typescript false when --typescript not provided', async () => {
      await main(['my-project', '--extensions', 'anthropic']);

      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          typescript: false,
        })
      );
    });

    it('defaults description to empty string when not provided', async () => {
      await main(['my-project', '--extensions', 'anthropic']);

      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          description: '',
        })
      );
    });
  });

  describe('EC-1: Invalid project name', () => {
    it('throws error for empty project name (AC-15)', async () => {
      await expect(main(['', '--extensions', 'anthropic'])).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Missing project name'
      );
    });

    it('throws ValidationError for whitespace-only project name', async () => {
      await expect(
        main(['   ', '--extensions', 'anthropic'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Project name must be valid npm package name'
      );
    });

    it('throws ValidationError for project name = . (AC-16)', async () => {
      await expect(main(['.', '--extensions', 'anthropic'])).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Project name must be valid npm package name'
      );
    });

    it('throws ValidationError for project name with path traversal', async () => {
      await expect(
        main(['../my-project', '--extensions', 'anthropic'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Project name must be valid npm package name'
      );
    });

    it('throws ValidationError for project name with backslash', async () => {
      await expect(
        main(['my\\project', '--extensions', 'anthropic'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Project name must be valid npm package name'
      );
    });

    it('throws ValidationError for project name with uppercase', async () => {
      await expect(
        main(['MyProject', '--extensions', 'anthropic'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Project name must be valid npm package name'
      );
    });

    it('throws ValidationError for project name with spaces', async () => {
      await expect(
        main(['my project', '--extensions', 'anthropic'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Project name must be valid npm package name'
      );
    });

    it('accepts valid unscoped package name', async () => {
      await main(['my-project', '--extensions', 'anthropic']);
      expect(mockScaffold).toHaveBeenCalled();
    });

    it('accepts valid scoped package name', async () => {
      await main(['@scope/my-project', '--extensions', 'anthropic']);
      expect(mockScaffold).toHaveBeenCalled();
    });

    it('accepts package name with hyphens', async () => {
      await main(['my-project-name', '--extensions', 'anthropic']);
      expect(mockScaffold).toHaveBeenCalled();
    });

    it('accepts package name with underscores', async () => {
      await main(['my_project', '--extensions', 'anthropic']);
      expect(mockScaffold).toHaveBeenCalled();
    });

    it('accepts package name with numbers', async () => {
      await main(['my-project-123', '--extensions', 'anthropic']);
      expect(mockScaffold).toHaveBeenCalled();
    });
  });

  describe('EC-2: Unknown extension name', () => {
    it('throws ValidationError with list of valid extensions', async () => {
      await expect(
        main(['my-project', '--extensions', 'unknown'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Unknown extension: unknown. Valid:')
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('anthropic')
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('openai')
      );
    });

    it('validates all extensions in comma-separated list', async () => {
      await expect(
        main(['my-project', '--extensions', 'anthropic,invalid,openai'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Unknown extension: invalid')
      );
    });

    it('accepts all valid extension names', async () => {
      const validExtensions = [
        'anthropic',
        'openai',
        'gemini',
        'claude-code',
        'qdrant',
        'pinecone',
        'chroma',
      ];

      for (const ext of validExtensions) {
        mockScaffold.mockClear();
        await main(['my-project', '--extensions', ext]);
        expect(mockScaffold).toHaveBeenCalled();
      }
    });
  });

  describe('EC-3: Unknown preset name', () => {
    it('throws ValidationError with list of valid presets', async () => {
      await expect(
        main(['my-project', '--preset', 'unknown'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Unknown preset: unknown. Valid: rag, chatbot')
      );
    });

    it('accepts rag preset', async () => {
      await main(['my-project', '--preset', 'rag']);
      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: ['anthropic', 'qdrant'],
        })
      );
    });

    it('accepts chatbot preset', async () => {
      await main(['my-project', '--preset', 'chatbot']);
      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: ['anthropic'],
        })
      );
    });

    it('is case-insensitive for preset names', async () => {
      await main(['my-project', '--preset', 'RAG']);
      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: ['anthropic', 'qdrant'],
        })
      );
    });
  });

  describe('EC-4: --preset and --extensions both provided', () => {
    it('throws ValidationError when both flags present', async () => {
      await expect(
        main(['my-project', '--preset', 'rag', '--extensions', 'anthropic'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Cannot combine --preset and --extensions'
      );
    });

    it('throws ValidationError regardless of flag order', async () => {
      await expect(
        main(['my-project', '--extensions', 'anthropic', '--preset', 'rag'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Cannot combine --preset and --extensions'
      );
    });
  });

  describe('EC-5: Non-interactive mode, no --extensions or --preset', () => {
    it('throws ValidationError when --description provided without extension selection', async () => {
      await expect(
        main(['my-project', '--description', 'My app'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Provide --extensions or --preset (or omit all flags for interactive mode)'
      );
    });

    it('throws ValidationError when --package-manager provided without extension selection', async () => {
      await expect(
        main(['my-project', '--package-manager', 'pnpm'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Provide --extensions or --preset (or omit all flags for interactive mode)'
      );
    });

    it('throws ValidationError when --typescript provided without extension selection', async () => {
      await expect(main(['my-project', '--typescript'])).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Provide --extensions or --preset (or omit all flags for interactive mode)'
      );
    });

    it('throws ValidationError when --no-install provided without extension selection', async () => {
      await expect(main(['my-project', '--no-install'])).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Provide --extensions or --preset (or omit all flags for interactive mode)'
      );
    });
  });

  describe('AC-19: Unknown package manager value', () => {
    it('throws ValidationError for invalid package manager', async () => {
      await expect(
        main([
          'my-project',
          '--extensions',
          'anthropic',
          '--package-manager',
          'bower',
        ])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Invalid --package-manager value: bower. Must be one of: npm, pnpm, yarn'
      );
    });

    it('accepts npm as package manager', async () => {
      await main([
        'my-project',
        '--extensions',
        'anthropic',
        '--package-manager',
        'npm',
      ]);
      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          packageManager: 'npm',
        })
      );
    });

    it('accepts pnpm as package manager', async () => {
      await main([
        'my-project',
        '--extensions',
        'anthropic',
        '--package-manager',
        'pnpm',
      ]);
      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          packageManager: 'pnpm',
        })
      );
    });

    it('accepts yarn as package manager', async () => {
      await main([
        'my-project',
        '--extensions',
        'anthropic',
        '--package-manager',
        'yarn',
      ]);
      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          packageManager: 'yarn',
        })
      );
    });
  });

  describe('Mode Selection', () => {
    it('uses non-interactive mode when any flag is provided', async () => {
      // Should not prompt, should use flag values directly
      await main(['my-project', '--extensions', 'anthropic']);
      expect(mockScaffold).toHaveBeenCalled();
    });

    it('exits with code 1 on ValidationError', async () => {
      await expect(
        main(['my-project', '--extensions', 'unknown'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it('logs error message to stderr on ValidationError', async () => {
      await expect(
        main(['my-project', '--extensions', 'unknown'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Error:')
      );
    });
  });

  describe('Edge Cases', () => {
    it('handles missing project name', async () => {
      await expect(main([])).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Missing project name'
      );
    });

    it('handles --extensions without value', async () => {
      await expect(main(['my-project', '--extensions'])).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: --extensions requires a value'
      );
    });

    it('handles --preset without value', async () => {
      await expect(main(['my-project', '--preset'])).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: --preset requires a value'
      );
    });

    it('handles --description without value', async () => {
      await expect(main(['my-project', '--description'])).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: --description requires a value'
      );
    });

    it('handles --package-manager without value', async () => {
      await expect(main(['my-project', '--package-manager'])).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: --package-manager requires a value'
      );
    });

    it('trims whitespace from extension names', async () => {
      await main(['my-project', '--extensions', ' anthropic , openai ']);
      expect(mockScaffold).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: ['anthropic', 'openai'],
        })
      );
    });

    it('handles unknown flags', async () => {
      await expect(
        main(['my-project', '--extensions', 'anthropic', '--unknown-flag'])
      ).rejects.toThrow();
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: Unknown flag: --unknown-flag'
      );
    });
  });
});
