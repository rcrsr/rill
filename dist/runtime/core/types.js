/**
 * Runtime Types
 *
 * Public types for runtime configuration and execution results.
 * These types are the primary interface for host applications.
 */
/**
 * Bind callables in a dict to their containing dict.
 * This sets boundDict on each callable so they can access their container.
 */
export function bindDictCallables(value) {
    if (typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        '__type' in value ||
        '__rill_args' in value) {
        return value;
    }
    const dict = value;
    let hasBoundCallables = false;
    // Check if any values are callables that need binding
    for (const v of Object.values(dict)) {
        if (typeof v === 'object' &&
            v !== null &&
            '__type' in v &&
            v.__type === 'callable' &&
            !('boundDict' in v && v['boundDict'])) {
            hasBoundCallables = true;
            break;
        }
    }
    if (!hasBoundCallables)
        return value;
    // Create a new dict with bound callables
    const result = {};
    for (const [key, v] of Object.entries(dict)) {
        if (typeof v === 'object' &&
            v !== null &&
            '__type' in v &&
            v.__type === 'callable' &&
            !('boundDict' in v && v['boundDict'])) {
            result[key] = { ...v, boundDict: result };
        }
        else {
            result[key] = v;
        }
    }
    return result;
}
//# sourceMappingURL=types.js.map