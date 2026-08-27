# Credits & Third-Party Licenses

DevBroom is MIT licensed (see [LICENSE](LICENSE)). It stands on the work below — thank you to everyone
who built and maintains these.

Licenses listed here were read from the installed packages at the time of writing. Run
`npm ls --all` or check each package's own LICENSE file for the authoritative text.

## Runtime dependencies

| Library | Version | License | What DevBroom uses it for |
| --- | --- | --- | --- |
| [Electron](https://github.com/electron/electron) | 44.x | MIT | The desktop app shell and the main/renderer process split |
| [React](https://github.com/facebook/react) | 19.x | MIT | The entire user interface |
| [React DOM](https://github.com/facebook/react) | 19.x | MIT | Rendering React into the window |
| [Recharts](https://github.com/recharts/recharts) | 3.x | MIT | The category donut and top-projects bar chart |
| [node-llama-cpp](https://github.com/withcatai/node-llama-cpp) | 3.x | MIT | Running the optional local AI model offline |
| [trash](https://github.com/sindresorhus/trash) | 10.x | MIT | Moving items to the Recycle Bin / Trash instead of deleting them |
| [electron-store](https://github.com/sindresorhus/electron-store) | 11.x | MIT | Saving settings, rules, exclusions and cleanup reports locally |
| [Instrument Sans](https://github.com/fontsource/font-files) (via `@fontsource`) | 5.x | OFL-1.1 | The UI typeface, bundled locally so the app never calls out to a font CDN |

`node-llama-cpp` bundles [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT) and its `ggml`
tensor library (MIT).

## Build-time dependencies

| Tool | Version | License | Used for |
| --- | --- | --- | --- |
| [Vite](https://github.com/vitejs/vite) | 8.x | MIT | Dev server and production bundling of the renderer |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 6.x | MIT | React Fast Refresh and JSX transform |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 26.x | MIT | Packaging the Windows, macOS and Linux installers |

## Local AI models

Models are **not bundled** with DevBroom. Nothing is downloaded unless you explicitly pick a model in
Settings → Project AI Helper. Every tier is from the Qwen2.5 family under **Apache-2.0**, chosen
deliberately so there are no extra attribution or naming requirements for redistributors.

| Tier | Model | Size | License | Source |
| --- | --- | --- | --- | --- |
| Tiny (fastest) | Qwen2.5-0.5B-Instruct, Q4_K_M | ~491 MB | Apache-2.0 | [Qwen/Qwen2.5-0.5B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF) |
| Balanced | Qwen2.5-1.5B-Instruct, Q4_K_M | ~1.1 GB | Apache-2.0 | [Qwen/Qwen2.5-1.5B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF) |
| Recommended (best answers) | Qwen2.5-3B-Instruct, Q4_K_M | ~2.1 GB | Apache-2.0 | [Qwen/Qwen2.5-3B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF) |

Qwen2.5 is developed by the Qwen team at Alibaba Cloud. The Apache-2.0 licence requires that you keep
the licence and copyright notice with any copy you redistribute; it imposes no naming or branding rules.

> **If you add a Llama-family model to this list**, Meta's Llama 3.x Community License requires the
> notice **"Built with Llama"** to appear in your documentation, and any derived model name must begin
> with "Llama". DevBroom ships no Llama models specifically to avoid these obligations — if you change
> that, add the notice here.

## Icon and artwork

The DevBroom icon in `src/public/icon.png` and `build/icon.png` is provided by Uddhav Bhardwaj and is
covered by this project's MIT licence unless stated otherwise.
