// @ts-check

/** @type import('dts-bundle-generator/config-schema').BundlerConfig */
const config = {
  compilationOptions: {
    preferredConfigPath: './tsconfig.build.json',
    followSymlinks: false,
  },

  entries: [
    {
      filePath: './src/index.ts',
      outFile: './dist/index.d.ts',
      noCheck: true,

      libraries: {
        inlinedLibraries: [],
        importedLibraries: ['@rcrsr/rill', 'ioredis'],
      },

      output: {
        inlineDeclareGlobals: true,
        sortNodes: false,
        noBanner: false,
      },
    },
  ],
};

module.exports = config;
