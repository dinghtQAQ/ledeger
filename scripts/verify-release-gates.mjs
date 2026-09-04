import fs from 'node:fs';
import path from 'node:path';

const testSiteKey = '1x00000000000000000000AA';

function stripJsonComments(source) {
	let output = '';
	let inString = false;
	let escaped = false;
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		const next = source[index + 1];
		if (inString) {
			output += char;
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			output += char;
		} else if (char === '/' && next === '/') {
			while (index < source.length && source[index] !== '\n') index += 1;
			output += '\n';
		} else if (char === '/' && next === '*') {
			index += 2;
			while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
			index += 1;
		} else {
			output += char;
		}
	}
	return output.replace(/,\s*([}\]])/g, '$1');
}

function readConfig(configPath) {
	try {
		return JSON.parse(stripJsonComments(fs.readFileSync(configPath, 'utf8')));
	} catch (error) {
		throw new Error(`Unable to read Wrangler config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
const configPath = configIndex >= 0 && args[configIndex + 1] ? path.resolve(args[configIndex + 1]) : path.resolve('wrangler.jsonc');
const config = readConfig(configPath);
const assets = config.assets;
if (!assets || assets.directory !== './dist' || assets.binding !== 'ASSETS' || assets.run_worker_first !== true) {
	throw new Error(`Wrangler config ${configPath} must bind ./dist as ASSETS with run_worker_first=true.`);
}

const distPath = path.resolve('dist');
if (!fs.existsSync(path.join(distPath, 'index.html'))) throw new Error('dist/index.html is missing; build the SPA before release.');
const assetFiles = fs.existsSync(path.join(distPath, 'assets'))
	? fs.readdirSync(path.join(distPath, 'assets'), { withFileTypes: true }).filter((entry) => entry.isFile())
	: [];
if (assetFiles.length === 0) throw new Error('dist/assets is empty; the SPA static assets were not built.');

const production = path.basename(configPath).includes('production');
if (production) {
	const siteKey = process.env.VITE_TURNSTILE_SITE_KEY?.trim();
	if (!siteKey || siteKey === testSiteKey) throw new Error('Production release requires a non-test VITE_TURNSTILE_SITE_KEY.');
	if (process.env.TURNSTILE_VERIFY_URL) throw new Error('TURNSTILE_VERIFY_URL is test-only and must not be set for production release.');
}

console.log(`Release gates passed: ${configPath} binds ASSETS with ${assetFiles.length + 1} SPA assets.`);
