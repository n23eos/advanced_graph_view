/** Graph export: JSON (generic) and GEXF (Gephi). Pure string builders. */
import type { GraphModel } from "../data/GraphStore";

export function graphToJson(model: GraphModel): string {
	return JSON.stringify(
		{
			nodes: model.nodes.map((node) => ({
				path: node.path,
				name: node.name,
				inCount: node.inCount,
				outCount: node.outCount,
			})),
			edges: model.edges.map((edge) => ({
				source: model.nodes[edge.source].path,
				target: model.nodes[edge.target].path,
				weight: edge.weight,
			})),
		},
		null,
		2
	);
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function graphToGexf(model: GraphModel): string {
	const nodes = model.nodes
		.map((node) => `      <node id="${node.id}" label="${escapeXml(node.name)}" />`)
		.join("\n");
	const edges = model.edges
		.map((edge, index) =>
			`      <edge id="${index}" source="${edge.source}" target="${edge.target}" weight="${edge.weight}" />`
		)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<gexf xmlns="http://gexf.net/1.3" version="1.3">
  <graph defaultedgetype="directed">
    <nodes>
${nodes}
    </nodes>
    <edges>
${edges}
    </edges>
  </graph>
</gexf>
`;
}

/** usage.json → CSV: path,date,opens (day granularity only). */
export function usageToCsv(log: Record<string, { total: number; days: Record<string, number> }>): string {
	const lines = ["path,date,opens"];
	for (const [path, usage] of Object.entries(log)) {
		for (const [day, count] of Object.entries(usage.days)) {
			lines.push(`"${path.replace(/"/g, '""')}",${day},${count}`);
		}
	}
	return lines.join("\n");
}
