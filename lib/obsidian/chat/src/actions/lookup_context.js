/**
 * @openapi
 * /lookup_context:
 *   post:
 *     operationId: lookup_context
 *     summary: Semantic search
 *     description: "Performs a semantic search of the user's data. Required: hypothetical_1 and hypothetical_2. Optional: hypothetical_3. Optionally, limit the search to a folder via `in_folder`. Optionally, append results to an existing SmartContext via `context_key`."
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hypothetical_1:
 *                 type: string
 *                 description: "Short hypothetical notes predicted to be semantically similar to the notes necessary to fulfill the user's request. At least three hypotheticals per request. The hypothetical notes may contain paragraphs, lists, or checklists in markdown format. Hypothetical notes always begin with breadcrumbs containing the anticipated folder(s), file name, and relevant headings separated by ' > ' (no slashes). Format: PARENT FOLDER NAME > CHILD FOLDER NAME > FILE NAME > HEADING 1 > HEADING 2 > HEADING 3: HYPOTHETICAL NOTE CONTENTS."
 *               hypothetical_2:
 *                 type: string
 *                 description: Must be distinct from and not share any breadcrumbs with hypothetical_1.
 *               hypothetical_3:
 *                 type: string
 *                 description: Must be distinct from hypothetical_1 and hypothetical_2.
 *               in_folder:
 *                 type: string
 *                 description: "Optional. Limit the lookup to items whose keys start with this folder (e.g. 'Projects/AI'). Ignored if set to '/' or left blank. A trailing slash is optional."
 *               context_key:
 *                 type: string
 *                 description: "Optional. The key of an existing SmartContext. When provided, lookup results are appended to this context instead of creating a new one."
 *             required:
 *               - hypothetical_1
 *               - hypothetical_2
 */
export async function lookup_context(params = {}) {
  const env = this.env;

  // Destructure params, extracting the new `in_folder` and `context_key` properties
  let {
    hypotheticals = [],
    hypothetical_1,
    hypothetical_2,
    hypothetical_3,
    in_folder,
    context_key,
    ...other_params
  } = params;

  /* ------------------------------------------------------------------
   * Normalise `hypotheticals` input formats (string | string[])
   * ---------------------------------------------------------------- */
  if (typeof hypotheticals === 'string') {
    if (hypotheticals.startsWith('[') && hypotheticals.endsWith(']')) {
      hypotheticals = JSON.parse(hypotheticals);
    } else if (hypotheticals.includes('\n')) {
      hypotheticals = hypotheticals.split('\n');
    } else {
      hypotheticals = [hypotheticals];
    }
  }

  // Collect explicitly-named hypotheticals
  if (hypothetical_1) hypotheticals.push(hypothetical_1);
  if (hypothetical_2) hypotheticals.push(hypothetical_2);
  if (hypothetical_3) hypotheticals.push(hypothetical_3);

  if (!hypotheticals?.length) return { error: 'hypotheticals is required' };

  /* ------------------------------------------------------------------
   * Handle context merging and duplicate filtering
   * ---------------------------------------------------------------- */
  let existing_context = null;
  let existing_item_keys = [];

  if (context_key) {
    existing_context = env.smart_contexts.get(context_key);
    if (existing_context?.data?.context_items) {
      existing_item_keys = Object.keys(existing_context.data.context_items);
    }
  }

  /* ------------------------------------------------------------------
   * Build or augment the filter
   * ---------------------------------------------------------------- */
  if (!other_params.filter) other_params.filter = {};

  // Folder scoping
  if (in_folder && in_folder !== '/') {
    if(env.smart_sources.fs.folders[in_folder]){
      if (!other_params.filter.key_starts_with) {
        const folder_prefix = in_folder.endsWith('/') ? in_folder : `${in_folder}/`;
        other_params.filter.key_starts_with = folder_prefix;
      }
    }else{
      console.warn(`Folder "${in_folder}" does not exist in the vault. Skipping folder scoping.`);
    }
  }

  // Exclude items that are already in the context
  if (existing_item_keys.length) {
    if (!Array.isArray(other_params.filter.exclude_keys)) other_params.filter.exclude_keys = [];
    other_params.filter.exclude_keys.push(...existing_item_keys);
  }

  /* ------------------------------------------------------------------
   * Perform the lookup
   * ---------------------------------------------------------------- */
  const collection = env.smart_blocks?.settings?.embed_blocks ? env.smart_blocks : env.smart_sources;
  const results = await collection.lookup({ ...other_params, hypotheticals });

  /* ------------------------------------------------------------------
   * Create or update the SmartContext
   * ---------------------------------------------------------------- */
  let context;

  if (existing_context) {
    // Append new results to the existing context
    existing_context.add_items(
      results.map((result) => ({ key: result.key, score: result.score }))
    );
    context = existing_context;
  } else {
    // Wrap results into a new SmartContext object for downstream use
    context = env.smart_contexts.new_context({
      context_items: results.reduce((acc, result) => {
        acc[result.key] = { d: 0, score: result.score };
        return acc;
      }, {})
    });
  }

  return context.key;
}

export const tool = {
  type: 'function',
  function: {
    name: 'lookup_context',
    description:
      "Common, frequently used. Performs a semantic search of the user's data. Use to respond to 'Based on my notes...' or any other query that might require surfacing unspecified content. Minimum 3 hypothetical notes predicted to be semantically similar to the notes necessary to fulfill the user's request. Each hypothetical is a semantic representation of content that's likely relevant to the user's request. Hypothetical notes always begin with breadcrumbs containing the hypothetical folder(s) and file name (separated by ' > '). Example: HYPOTHETICAL FOLDER NAME > CHILD FOLDER NAME > FILE NAME: HYPOTHETICAL NOTE CONTENTS. Important: minimum 3.",
    parameters: {
      type: 'object',
      properties: {
        hypothetical_1: {
          type: 'string',
          description:
            "Always begin with breadcrumbs containing the hypothetical folder(s) and file name (separated by ' > '). Example: HYPOTHETICAL FOLDER NAME > CHILD FOLDER NAME > FILE NAME: HYPOTHETICAL NOTE CONTENTS. Important: minimum 3."
        },
        hypothetical_2: {
          type: 'string',
          description: 'Must be distinct from and not share any breadcrumbs with hypothetical_1.'
        },
        hypothetical_3: {
          type: 'string',
          description: 'Must be distinct from hypothetical_1 and hypothetical_2.'
        },
        in_folder: {
          type: 'string',
          description:
            "Use only if absolutely required. Exclude unles asked for a specific folder. Limits the lookup to items in this folder."
        },
        // EXCLUDED because used internally and the model currently isn't aware of the current context key
        // context_key: {
        //   type: 'string',
        //   description:
        //     "Optional. The key of an existing SmartContext. When provided, lookup results are appended to this context instead of creating a new one."
        // }
      },
      required: ['hypothetical_1', 'hypothetical_2']
    }
  }
};

export async function render_output(env, output, params) {
  const context = env.smart_contexts.get(output);
  if (!context) {
    return `No context found for key: ${output}`;
  }
  return await env.render_component('context_builder', context);
}