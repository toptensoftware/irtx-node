// Module loader hook — registered at runtime by the configure command.
// Intercepts `import "irtx:binpack"` and serves the source fetched from the irtx repo,
// so activities.js files can import helpers without any local install.

let source = null;

export function initialize(data) {
    source = data.source;
}

export function resolve(specifier, context, nextResolve) {
    if (specifier === "irtx:binpack")
        return { shortCircuit: true, url: "irtx:binpack" };
    return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
    if (url === "irtx:binpack")
        return { shortCircuit: true, format: "module", source };
    return nextLoad(url, context);
}
