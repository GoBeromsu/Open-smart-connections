/**
 * SmartFsAdapterBase class
 *
 * Base class for SmartFs adapters providing common utility methods
 * and default implementations for derived list methods.
 *
 * @class
 * @classdesc Base adapter class with shared functionality for SmartFs adapters
 */
export class SmartFsAdapterBase {
  /**
   * Create a SmartFsAdapterBase instance
   * @param {Object} smart_fs - The SmartFs instance
   */
  constructor(smart_fs) {
    this.smart_fs = smart_fs;
  }

  /**
   * Normalize a file path by converting backslashes to forward slashes,
   * removing the fs_path prefix, and stripping leading slashes.
   * @param {string} file_path - The file path to normalize
   * @returns {string} The normalized path
   */
  _normalize_rel_path(file_path) {
    return file_path
      .replace(/\\/g, '/') // normalize slashes
      .replace(this.smart_fs.fs_path, '') // remove fs_path
      .replace(/^\//, ''); // remove leading slash
  }

  /**
   * Parse the file extension from a path
   * @param {string} file_path - The file path
   * @returns {string} The lowercase extension
   */
  _parse_extension(file_path) {
    return file_path.split('.').pop().toLowerCase();
  }

  /**
   * Parse the file name from a path (last segment after /)
   * @param {string} file_path - The file path
   * @returns {string} The file name
   */
  _parse_name(file_path) {
    return file_path.split('/').pop();
  }

  /**
   * Parse the basename from a file name (name without extension)
   * @param {string} file_name - The file name
   * @returns {string} The basename
   */
  _parse_basename(file_name) {
    return file_name.split('.').shift();
  }

  /**
   * Build a file metadata object with common properties
   * @param {string} file_path - The original file path
   * @returns {Object} File metadata object with path, type, extension, name, basename
   */
  _build_file_meta(file_path) {
    const path = this._normalize_rel_path(file_path);
    const name = this._parse_name(path);
    return {
      path,
      type: 'file',
      extension: this._parse_extension(path),
      name,
      basename: this._parse_basename(name)
    };
  }

  /**
   * List files and folders recursively
   * Default implementation that calls list() recursively for folders.
   * Adapters should override this for more efficient implementations.
   * @param {string} rel_path - Relative path to list
   * @param {Object} opts - Options for listing
   * @returns {Promise<Array>} Array of file/folder objects
   */
  async list_recursive(rel_path = '', opts = {}) {
    const all_items = [];
    const process_items = async (current_path) => {
      const items = await this.list(current_path, opts);
      for (const item of items) {
        all_items.push(item);
        if (item.type === 'folder') {
          await process_items(item.path);
        }
      }
    };
    await process_items(rel_path);
    return all_items;
  }

  /**
   * List only files in a directory
   * @param {string} rel_path - Relative path to list
   * @param {Object} opts - Additional options
   * @returns {Promise<Array>} Array of file objects
   */
  async list_files(rel_path = '', opts = {}) {
    return await this.list(rel_path, { ...opts, type: 'file' });
  }

  /**
   * List files recursively
   * @param {string} rel_path - Relative path to list
   * @param {Object} opts - Additional options
   * @returns {Promise<Array>} Array of file objects
   */
  async list_files_recursive(rel_path = '', opts = {}) {
    const items = await this.list_recursive(rel_path, opts);
    return items.filter(item => item.type === 'file');
  }

  /**
   * List only folders in a directory
   * @param {string} rel_path - Relative path to list
   * @param {Object} opts - Additional options
   * @returns {Promise<Array>} Array of folder objects
   */
  async list_folders(rel_path = '', opts = {}) {
    return await this.list(rel_path, { ...opts, type: 'folder' });
  }

  /**
   * List folders recursively
   * @param {string} rel_path - Relative path to list
   * @param {Object} opts - Additional options
   * @returns {Promise<Array>} Array of folder objects
   */
  async list_folders_recursive(rel_path = '', opts = {}) {
    const items = await this.list_recursive(rel_path, opts);
    return items.filter(item => item.type === 'folder');
  }
}
