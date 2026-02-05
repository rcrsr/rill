/**
 * AnnotationsMixin: Annotated Statement Execution
 *
 * Provides statement execution wrapper with annotation handling.
 * Annotations modify execution behavior (e.g., iteration limits).
 *
 * Interface requirements (from spec IR-53 through IR-55):
 * - executeStatement(stmt) -> Promise<RillValue> [IR-53]
 * - getAnnotation(key) -> RillValue | undefined [IR-54]
 * - getIterationLimit() -> number [IR-55]
 *
 * Error Handling:
 * - Annotated statement execution errors propagate [EC-25]
 * - Annotation evaluation errors propagate [EC-26]
 *
 * @internal
 */
export declare const AnnotationsMixin: any;
//# sourceMappingURL=annotations.d.ts.map