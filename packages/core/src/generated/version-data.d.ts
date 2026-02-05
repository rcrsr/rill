/**
 * Version information structure
 */
export interface VersionInfo {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly prerelease: string | undefined;
}
/**
 * Version string from package.json
 */
export declare const VERSION = "0.5.0";
/**
 * Parsed version components
 */
export declare const VERSION_INFO: VersionInfo;
//# sourceMappingURL=version-data.d.ts.map