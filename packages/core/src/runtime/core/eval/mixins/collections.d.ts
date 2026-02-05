/**
 * CollectionsMixin: each/map/fold/filter
 *
 * Handles collection operators:
 * - Each: sequential iteration with all results (partial results on break)
 * - Map: parallel iteration with all results
 * - Fold: sequential reduction to final value
 * - Filter: parallel filtering by predicate
 *
 * Interface requirements (from spec):
 * - evaluateEach(node, input) -> Promise<RillValue[]>
 * - evaluateMap(node, input) -> Promise<RillValue[]>
 * - evaluateFold(node, input) -> Promise<RillValue>
 * - evaluateFilter(node, input) -> Promise<RillValue[]>
 *
 * Error Handling:
 * - Non-iterable inputs throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-10]
 * - Iterator body evaluation errors propagate correctly [EC-11]
 * - Iteration limit exceeded throws RuntimeError [EC-12]
 *
 * @internal
 */
export declare const CollectionsMixin: any;
//# sourceMappingURL=collections.d.ts.map