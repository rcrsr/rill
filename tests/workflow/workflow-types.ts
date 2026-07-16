/**
 * Shared shapes for the GitHub Actions workflow YAML that these tests parse.
 *
 * Only the fields the workflow tests actually read are modelled. Steps come
 * from parseYaml, so these describe the parsed document rather than the full
 * Actions schema.
 */

/** A single step within a workflow job. */
export interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}
