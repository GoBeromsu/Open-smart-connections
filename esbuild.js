import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

/**
 * Plugin to process CSS files imported with an import attribute:
 *   import sheet from './style.css' with { type: 'css' };
 *
 * When such an import is detected, the plugin loads the CSS file,
 * optionally minifies it if the build options request minification,
 * and wraps the CSS text into a new CSSStyleSheet. The module then
 * exports the stylesheet as its default export.
 *
 * @returns {esbuild.Plugin} The esbuild plugin object.
 */
export function css_with_plugin() {
  return {
    name: 'css-with-plugin',
    setup(build) {
      // Intercept all .css files
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        // Check for the "with" import attribute and that its type is 'css'
        if (args.with && args.with.type === 'css') {
          // Read the CSS file contents
          const fs = await import('fs/promises');
          let css_content = await fs.readFile(args.path, 'utf8');

          // Optionally transform (minify) the CSS if minification is enabled
          const should_minify = build.initialOptions.minify || false;
          if (should_minify) {
            const result = await esbuild.transform(css_content, {
              loader: 'css',
              minify: true,
            });
            css_content = result.code;
          }

          // Escape any backticks in the CSS content to avoid breaking the template literal
          const escaped_css = css_content.replace(/`/g, '\\`');

          // Create a JavaScript module that creates a CSSStyleSheet and exports it
          const js_module = `
            const css_sheet = new CSSStyleSheet();
            css_sheet.replaceSync(\`${escaped_css}\`);
            export default css_sheet;
          `;

          return {
            contents: js_module,
            loader: 'js',
          };
        }
        // If the "with" attribute is not present or not type "css",
        // return undefined so that other loaders/plugins can process it.
      });
    },
  };
}

// if directory doesn't exist, create it
if(!fs.existsSync(path.join(process.cwd(), 'dist'))) {
  fs.mkdirSync(path.join(process.cwd(), 'dist'), { recursive: true });
}

const main_path = path.join(process.cwd(), 'dist', 'main.js');
const manifest_path = path.join(process.cwd(), 'manifest.json');
const styles_path = path.join(process.cwd(), 'src', 'styles.css');
// Update manifest.json version
const package_json = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json')));
const manifest_json = JSON.parse(fs.readFileSync(manifest_path));
manifest_json.version = package_json.version;
fs.writeFileSync(manifest_path, JSON.stringify(manifest_json, null, 2));
// copy manifest and styles to dist
fs.copyFileSync(manifest_path, path.join(process.cwd(), 'dist', 'manifest.json'));
fs.copyFileSync(styles_path, path.join(process.cwd(), 'dist', 'styles.css'));

const destination_vaults = (process.env.DESTINATION_VAULTS || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

function resolveExistingVaultPath(vault) {
  if (!vault) return null;
  if (path.isAbsolute(vault)) return fs.existsSync(vault) ? vault : null;

  const fromCwd = path.resolve(process.cwd(), vault);
  if (fs.existsSync(fromCwd)) return fromCwd;

  // Back-compat: previous builds resolved relative to the parent directory.
  const fromParent = path.resolve(process.cwd(), '..', vault);
  if (fs.existsSync(fromParent)) return fromParent;

  return null;
}

const cli_args = process.argv.slice(2);
const is_watch = cli_args.includes('--watch');

// markdown plugin
const markdown_plugin = {
  name: 'markdown',
  setup(build) {
    build.onLoad({ filter: /\.md$/ }, async (args) => {
      if(args.with && args.with.type === 'markdown') {
        const text = await fs.promises.readFile(args.path, 'utf8');
        return {
          contents: `export default ${JSON.stringify(text)};`,
          loader: 'js'
        };
      }
    });
  }
};
const worker_path = path.join(process.cwd(), 'dist', 'embed-worker.js');
const release_file_paths = [manifest_path, styles_path, main_path, worker_path];

function copy_output_plugin() {
  return {
    name: 'copy-output-plugin',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors?.length) return;
        console.log('Build complete');
        for (const vaultEntry of destination_vaults) {
          const vaultPath = resolveExistingVaultPath(vaultEntry);
          if (!vaultPath) {
            console.warn(`Skipping DESTINATION_VAULTS entry (not found): ${vaultEntry}`);
            continue;
          }

          const destDir = path.join(vaultPath, '.obsidian', 'plugins', manifest_json.id);
          console.log(`Copying files to ${destDir}`);
          fs.mkdirSync(destDir, { recursive: true });
          for (const file_path of release_file_paths) {
            fs.copyFileSync(file_path, path.join(destDir, path.basename(file_path)));
          }
          // Copy worker file if it exists
          if (fs.existsSync(worker_path)) {
            fs.copyFileSync(worker_path, path.join(destDir, path.basename(worker_path)));
          }
          // Touch hot reload marker on every successful build.
          fs.writeFileSync(path.join(destDir, '.hotreload'), String(Date.now()));
          console.log(`Copied files to ${destDir}`);
        }
      });
    },
  };
}

// Build the project (connector code is inlined in transformers.ts, no separate worker needed)
const build_options = {
  entryPoints: {
    'main': 'src/main.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.js' },
  format: 'cjs',
  bundle: true,
  write: true,
  target: "es2018",
  logLevel: "info",
  treeShaking: true,
  platform: 'node',
  // Keep default symlink resolution so pnpm-linked transitive deps
  // (e.g. js-tiktoken -> base64-js) resolve consistently in CI.
  preserveSymlinks: false,
  external: [
    'electron',
    'obsidian',
    'crypto',
    '@xenova/transformers',
    '@huggingface/transformers',
    'http',
    'url',
  ],
  define: {
    'process.env.DEFAULT_OPEN_ROUTER_API_KEY': JSON.stringify(process.env.DEFAULT_OPEN_ROUTER_API_KEY || ''),
  },
  plugins: [css_with_plugin(), markdown_plugin, copy_output_plugin()],
};

if (is_watch) {
  const ctx = await esbuild.context(build_options);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(build_options).catch(() => process.exit(1));
}
