// The core's tests run as an amxts project over the two official modules.
// About this file: https://amxts.github.io/docs/getting-started/quick-start#a-project
export default defineConfig({
	pluginsDir: "as", // the core has no plugins: as/ is the API
	outDir: "dist-wasm",
	modules: ["@amxts/config-core", "@amxts/menu-core"],
});
