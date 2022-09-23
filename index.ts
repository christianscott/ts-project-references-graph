import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

async function main() {
	let i = 2;
	const opts: { tsconfigsFile?: string; baseDir?: string } = {};
	while (i < process.argv.length) {
		const arg = process.argv[i];
		switch (arg) {
			case "--tsconfigs":
				opts.tsconfigsFile = process.argv[++i];
				break;
			case "--base-dir":
				opts.baseDir = process.argv[++i];
				break;
			default:
				throw new Error("unrecognized argument: " + arg);
		}
		i++;
	}

	const tsconfigsFile = path.join(process.cwd(), mustExist(opts.tsconfigsFile));
	const tsconfigFilenames = fs
		.readFileSync(tsconfigsFile, "utf-8")
		.split(os.EOL)
		.filter((f) => f.trim().length > 0)
		.map((f) => path.normalize(f));

	console.error("creating graph");
	let depGraph = new DirectedGraph<string>();
	for (const tsconfigFilename of tsconfigFilenames) {
		const dirname = path.dirname(tsconfigFilename);
		const { config, error } = ts.readConfigFile(
			path.join(mustExist(opts.baseDir), tsconfigFilename),
			ts.sys.readFile,
		);
		if (error != null) {
			throw new Error(error.messageText.toString());
		}
		if (config.references == null) {
			continue;
		}
		const refs = config.references as readonly { path: string }[];
		const absRefs = refs.map((ref) => path.join(dirname, ref.path));
		depGraph.add(dirname, ...absRefs);
	}
	depGraph = depGraph.invert();

	console.error("discovering the longest path");
	const longestPathFinder = new LongestPathFinder(depGraph);

	let xs = [...longestPathFinder.longestPathToPkgs.entries()];
	xs.sort((a, b) => {
		return b[1] - a[1];
	});
	let printed = 0;
	const longest: any = {};
	for (const x of xs) {
		if (printed === 10) {
			break;
		}
		const longestPath = longestPathFinder.longestPathEndingWith(x[0]);
		longest[x[0]] = {
			len: x[1],
			longestPath,
		};
		printed++;
	}
	console.log(JSON.stringify(longest, null, 2));
}

class LongestPathFinder {
	private readonly invertedDepGraph: DirectedGraph<string>;
	readonly longestPathToPkgs: Map<string, number> = new Map();

	constructor(depGraph: DirectedGraph<string>) {
		this.invertedDepGraph = depGraph.invert();

		for (const pkg of depGraph.topoSort()) {
			const dependees = this.invertedDepGraph.edges.get(pkg);
			assert(dependees, "missing dependees for " + pkg);
			if (dependees.size === 0) {
				this.longestPathToPkgs.set(pkg, 1);
				continue;
			}
			let longestPathToPkgLen = -1;
			for (const dependee of dependees) {
				const longestPathToDependeeLen = this.longestPathToPkgs.get(dependee);
				assert(longestPathToDependeeLen != null);
				if (longestPathToDependeeLen + 1 > longestPathToPkgLen) {
					longestPathToPkgLen = longestPathToDependeeLen + 1;
				}
			}
			assert(longestPathToPkgLen !== -1);
			this.longestPathToPkgs.set(pkg, longestPathToPkgLen);
		}
	}

	longestPath() {
		let terminalPkgOfLongestPath: string | undefined,
			longestPathLen: number | undefined;
		for (const [pkg, longestPathToPkgLen] of this.longestPathToPkgs.entries()) {
			if (
				terminalPkgOfLongestPath == null ||
				longestPathLen == null ||
				longestPathToPkgLen > longestPathLen
			) {
				terminalPkgOfLongestPath = pkg;
				longestPathLen = longestPathToPkgLen;
			}
		}
		assert(terminalPkgOfLongestPath != null && longestPathLen != null);
		return this.longestPathEndingWith(terminalPkgOfLongestPath);
	}

	longestPathEndingWith(terminalPkgOfLongestPath: string) {
		const longestPath: string[] = [terminalPkgOfLongestPath];
		let toVisit: string | undefined = terminalPkgOfLongestPath;
		while (toVisit != null) {
			const dependees = this.invertedDepGraph.edges.get(toVisit);
			assert(dependees, "missing dependees for " + toVisit);
			if (dependees.size === 0) {
				toVisit = undefined;
				continue;
			}

			let dependeeWithLongestPath: string | undefined,
				longestPathToDependeeLen: number | undefined;
			for (const dependee of dependees) {
				const len = this.longestPathToPkgs.get(dependee);
				assert(len != null);
				if (
					dependeeWithLongestPath == null ||
					longestPathToDependeeLen == null ||
					len > longestPathToDependeeLen
				) {
					dependeeWithLongestPath = dependee;
					longestPathToDependeeLen = len;
				}
			}
			assert(
				dependeeWithLongestPath != null && longestPathToDependeeLen != null,
			);
			longestPath.push(dependeeWithLongestPath);
			toVisit = dependeeWithLongestPath;
		}
		return longestPath;
	}
}

class DirectedGraph<T> {
	readonly edges: Map<T, Set<T>> = new Map();

	add(from: T, ...to: T[]) {
		let dependencies = this.edges.get(from);
		if (dependencies == null) {
			dependencies = new Set();
			this.edges.set(from, dependencies);
		}
		Sets.addAll(dependencies, to);
		this.ensureAll(to);
	}

	private ensureAll(nodes: Iterable<T>) {
		for (const node of nodes) {
			if (!this.edges.has(node)) {
				this.edges.set(node, new Set());
			}
		}
	}

	isCyclic(): boolean {
		const seenOnAllWalks = new Set<T>();
		for (const node of this.edges.keys()) {
			if (seenOnAllWalks.has(node)) {
				continue;
			}

			const seenOnThisWalk = new Set<T>();
			const toVisit = [...this.edges.get(node)!];
			while (toVisit.length > 0) {
				const nextNode = toVisit.shift()!;
				if (seenOnThisWalk.has(nextNode)) {
					return true; // cyclic
				}
				seenOnThisWalk.add(nextNode);
				const nextNodeChildren = this.edges.get(nextNode);
				nextNodeChildren && toVisit.push(...nextNodeChildren);
			}

			Sets.addAll(seenOnAllWalks, seenOnThisWalk);
		}

		return false;
	}

	indegrees() {
		const inDegrees = new Map<T, number>();
		for (const [node, neighbours] of this.edges.entries()) {
			if (!inDegrees.has(node)) {
				inDegrees.set(node, 0);
			}

			for (const neighbour of neighbours) {
				const count = inDegrees.get(neighbour) || 0;
				inDegrees.set(neighbour, count + 1);
			}
		}
		return inDegrees;
	}

	topoSort(): readonly T[] {
		const inDegrees = this.indegrees();
		const sources: T[] = [];
		for (const [node, count] of inDegrees.entries()) {
			if (count === 0) {
				sources.push(node);
			}
		}

		assert(
			sources.length > 0,
			`a DAG must have at least one source (a node with an in-degree of 0)`,
		);

		const topologicalOrdering = [];
		while (sources.length > 0) {
			const node = sources.pop()!;
			topologicalOrdering.push(node);
			const neighbours = this.edges.get(node) || new Set();
			for (const neighbour of neighbours) {
				const neighbourIndegree = inDegrees.get(neighbour)! - 1;
				inDegrees.set(neighbour, neighbourIndegree);
				if (neighbourIndegree === 0) {
					sources.push(neighbour);
				}
			}
		}

		assert(
			topologicalOrdering.length === this.edges.size,
			`Graph has a cycle! No topological ordering exists.`,
		);

		return topologicalOrdering;
	}

	invert(): DirectedGraph<T> {
		const inverted = new DirectedGraph<T>();
		for (const [edge, deps] of this.edges) {
			inverted.add(edge);
			for (const dep of deps) {
				inverted.add(dep, edge);
			}
		}
		return inverted;
	}

	walk(start: T): Set<T> {
		const toVisit = [start];
		const seen = new Set<T>();
		while (toVisit.length > 0) {
			const next = toVisit.shift()!;
			for (const dep of this.edges.get(next)!) {
				if (seen.has(dep)) {
					continue;
				}
				toVisit.push(dep);
			}
			seen.add(next);
		}
		return seen;
	}

	subgraph(keep: Set<T>): DirectedGraph<T> {
		const subgraph = new DirectedGraph<T>();
		for (const [node, deps] of this.edges) {
			if (!keep.has(node)) {
				continue;
			}
			subgraph.add(node, ...[...deps].filter((dep) => keep.has(dep)));
		}
		return subgraph;
	}

	printAsGraphVis(): string {
		let out = "";
		const line = (s: string) => (out += s + "\n");

		line("digraph G {");
		for (const [pkg, deps] of this.edges) {
			line(`  "${pkg}"`);
			for (const dep of deps) {
				line(`  "${pkg}" -> "${dep}"`);
			}
		}
		line("}");

		return out;
	}
}

class Sets {
	static addAll<T>(s: Set<T>, xs: Iterable<T>) {
		for (const x of xs) {
			s.add(x);
		}
	}
}

function mustExist<T>(x: T | null | undefined): T {
	assert(x != null);
	return x;
}

main().catch((err) => {
	throw err;
});
