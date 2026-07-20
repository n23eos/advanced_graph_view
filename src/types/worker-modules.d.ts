/** "worker:./x.worker" imports resolve to the bundled worker source string. */
declare module "worker:*" {
	const source: string;
	export default source;
}
