# minimal-modern-node-http-mocking

A research and diagnostic suite designed to isolate, document, and resolve the complexities of HTTP mocking in modern Node.js environments.

## 1. Project Genesis

This project was born out of a specific need during the development of a burgeoning application that interacts with GitHub via the **Octokit** library. While the parent project is in its early stages, it is being built to the rigorous standards of a large-scale production environment—a standard I have carried over from my previous experience in such high-stakes ecosystems.

As complexity began to grow, network mocking became a "black box"—too many moving parts and a lack of visibility into why certain requests were failing, especially when wrapped inside Octokit's internal request logic. I created this repository to **isolate the noise**. By stripping away everything except the essential transport layers and mocking engines, I built a controlled environment to solve a specific, high-friction problem: **handling "204 No Content" responses** in a world of strict Undici/Node.js native fetch implementations.

This project is a solo effort, developed with the insightful assistance of the **Gemini LLM**, which served as a collaborative partner in navigating the nuances of these library conflicts.

---

## 2. Background

### 2.1 The Modern Node Network Gap

The Node.js ecosystem is currently in a state of transition. Historically, Node relied on the `http` and `https` modules, and almost every mocking tool (like Nock) was built to monkey-patch those specific modules.

With the relatively recent introduction of **native fetch** (powered by the Undici engine), the underlying network stack has changed significantly. Many established tools are still catching up to this new reality.

### 2.2 Why not use MSW?

In modern applications, complexity scales quickly. While newer tools like **MSW (Mock Service Worker)** are excellent for manual mocking and provide great support for the new fetch API, they currently lack robust, first-class support for **record and playback** features in a Node.js server-side context.

For complex projects, manual mocking is often unmaintainable. The ability to automatically record real traffic and play it back is essential for reliable testing, which leads us back to Nock and Polly.js—tools that support automation but struggle with the strictness of the new native fetch stack (particularly with 204 responses). This project exists to bridge that gap.

---

## 3. The Four Operational Modes

The testing strategy is built on an incremental foundation. Instead of jumping straight to automation, I established a manual baseline to ensure there is always a "known good" state to return to.

| Mode | Description | Purpose |
| --- | --- | --- |
| **`off`** | No mocking libraries active. | **The Truth.** Hits the real local Express server to confirm the network works natively. |
| **`live`** | Hand-made mocks/interceptors. | **The Baseline.** Proves that I can successfully intercept and control the request manually. |
| **`record`** | Auto-mocking enabled (Writing). | **The Bridge.** Captures real network traffic and persists it to the file system. |
| **`playback`** | Auto-mocking enabled (Reading). | **The Automation.** Runs tests against saved fixtures without requiring a live server. |

> **Note on Assertions:** In this suite, assertions change depending on the mode. This is intentional. The tests are designed to prove the *capability* of the tool in that specific mode (e.g., documenting where a library is inherently incompatible with a status code).

---

## 4. Testing Dimensions

The project is structured to test the intersection of five critical dimensions:

1. **Mocking Engines:** Nock vs. Polly.js
2. **Mocking Strategy:** Hand-coded interceptors (`live`) vs. Automated recordings (`record`/`playback`)
3. **Response Types:** Standard data requests vs. **204 No Content** (the "Incompatibility" edge case)
4. **Transport Layers:** Native `fetch` (Undici), `node-fetch`, and `axios`
5. **Abstraction Level:** Direct network connections (test environment setup) vs. **Octokit** library requests (the primary target)

---

## 5. Key Findings: The 204 Incompatibility Matrix

One of the primary discoveries of this project is the "Opposite Incompatibility" between Nock and Polly when dealing with 204 status codes in modern Node.js:

| Library | Live Mode (Hand Mocks) | Record/Playback (Auto) |
| --- | --- | --- |
| **Nock** | ✅ **Compatible** | ❌ **Incompatible** (Crashes on fixture body) |
| **Polly.js** | ❌ **Incompatible** (Crashes on `Response` construction) | ✅ **Compatible** (HAR abstraction fixes it) |

---

## 6. Usage

### 6.1 Prerequisites

* Node.js v18+ (for native fetch support)
* A basic understanding of ESM in Node.js

### 6.2 Installation

```bash
npm install

```

### 6.3 Running Tests

Prefix the command with the environment variable to set the mode.

**Nock Tests:**

```bash
NOCK_MODE=live npm run test:nock

```

**Polly Tests:**

```bash
POLLY_MODE=record npm run test:polly

```

---

## 7. Reproducibility & Environment

This research was conducted under specific conditions. Because the "204 bug" is tied to the internal evolution of the Node.js Undici engine, using these exact versions is critical to reproducing the documented behaviors.

### 7.1 Tested Environment

| Component | Version |
| --- | --- |
| **Node.js** | `v22.15.0` (or whatever you are using) |
| **Nock** | `v14.0.15` |
| **Polly.js** | `v6.0.6` |
| **Octokit** | `v5.0.5` |

### 7.2 Ensuring Consistency

A `package-lock.json` is included to pin dependency versions. To ensure you are using the correct Node.js runtime, it is recommended to use [nvm](https://github.com/nvm-sh/nvm) and run:

```bash
# If you add an .nvmrc file
nvm use

```

---

## 8. Author

**Mark Smith** (with help from Gemini)
