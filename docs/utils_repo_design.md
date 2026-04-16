# Utilities Repo Design

## Goal

Create a lightweight `sensein/utils` repository that:

- stores one reusable utility per folder
- keeps browser demos distributable from the repository
- publishes a summary catalog through GitHub Pages
- makes it easy to add new utilities without hand-editing the Pages landing page

## Implementation plan

- [x] Create a `utilities/` convention for one utility per folder
- [x] Package the streaming audio workbench into its own utility folder
- [x] Add root documentation for how to add new utilities
- [x] Add metadata-driven catalog generation for GitHub Pages
- [x] Add a lightweight test for the catalog generator
- [x] Add a GitHub Actions workflow that builds and deploys the catalog

## Assumptions

- Utilities should remain self-contained whenever possible so they can be copied into the Pages artifact without a separate build system.
- `utility.json` is the contract for whether a utility has a live exploration page.
- The first target utility is the single-file streaming audio workbench HTML page.
