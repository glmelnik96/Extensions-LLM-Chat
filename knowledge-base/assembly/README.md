# Assembly

Assembly logic that builds grounded prompts from the corpus and prompt library lives in the extension:

- **pipelineAssembly.js** (in the extension root) loads prompt-library content and knowledge-base index, and assembles role-specific messages for generator, validator, and repair.

This folder is reserved for any future knowledge-base-side assembly helpers (e.g. snippet selection by query). The runtime does not require files in this folder.
