A tool for analysing the dependency graph of a TypeScript project using the project references feature.

Currently only supports extracting the longest dependency chain in your project.

## Usage

```sh
$ ./run.sh ~/path/to/ts/project
```

## Dependencies

These need to be on your $PATH

- `node`
- [`pnpm`](https://pnpm.io/)
- [`fd`](https://github.com/sharkdp/fd)
