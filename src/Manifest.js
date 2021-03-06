'use strict';

require('colors');
const fs = require('fs');
const log = require('loglevel');
const getAuthorRegex = require('author-regex');
const isPlainObject = require('lodash.isplainobject');


class Manifest {
    /**
     * Manifest constructor
     *
     * @param data Object containing initial data for the manifest
     */
    constructor(data) {
        Object.assign(this, data);

        this.write = this.write.bind(this);
        this.merge = this.merge.bind(this);
        this.setFieldValue = this.setFieldValue.bind(this);
        this.getFieldValue = this.getFieldValue.bind(this);

        this.isValid = this.isValid.bind(this);
        this.getMissingFields = this.getMissingFields.bind(this);
        this.getJSON = this.getJSON.bind(this);
    }


    /**
     * Returns a copy of the provided data where any properties that don't have values are removed
     *
     * @param {Object} data
     * @returns {Object}
     * @private
     */
    _cleanObject(data) {
        return Object.keys(data)
            .filter(field => isPlainObject(data[field]) || !!data[field])
            .reduce((obj, field) => {
                if (isPlainObject(data[field])) {
                    obj[field] = this._cleanObject(data[field]);
                } else {
                    obj[field] = data[field];
                }
                return obj;
            }, {});
    }


    /**
     * Merge the fields from the specified data with the current manifest
     *
     * @param {Object} data
     * @param {boolean} force If true, empty fields in the data will be removed from the manifest
     * @returns {Manifest}
     */
    merge(data, force) {
        if (data instanceof Object) {
            Object.keys(data).map(key => {
                if (data[key] instanceof Object) {
                    if (key === 'developer' && data[key].name) {
                        Object.assign(data[key], Manifest.parseAuthor(data[key].name));
                    }
                    const cleanData = force ? data[key] : this._cleanObject(data[key]);
                    this[key] = Object.assign({}, this[key], cleanData);
                } else if (data[key] || force) {
                    this[key] = data[key];
                }
            });
        }

        return this;
    }


    /**
     * Helper method to recursively set the value of a field
     *
     * @param object
     * @param fields
     * @param value
     * @private
     */
    static _setFieldValue(object, fields, value) {
        if (!Array.isArray(fields) || fields.length === 0) {
            throw new Error('fields must be an array');
        }

        if (fields.length > 1) {
            if (!object.hasOwnProperty(fields[0])) {
                object[fields[0]] = {};
                Manifest._setFieldValue(object[fields[0]], fields.splice(1), value);
            } else {
                if (!isPlainObject(object[fields[0]])) {
                    throw new Error('field is not an object');
                }

                Manifest._setFieldValue(object[fields[0]], fields.splice(1), value);
            }
        } else {
            if (value) {
                object[fields[0]] = value;
            } else {
                delete object[fields[0]];
            }
        }
    }


    /**
     * Set the value of the specified field
     *
     * @param fieldName The name of the field to add or modify, in dot notation (field.subfield.etc)
     * @param value
     */
    setFieldValue(fieldName, value) {
        if (fieldName === 'developer.name') {
            value = Manifest.parseAuthor(value);
            Manifest._setFieldValue(this, ['developer'], value);
        } else {
            Manifest._setFieldValue(this, fieldName.split('.'), value);
        }
    }


    /**
     * Helper method to recursively get the value of a field
     *
     * @param object
     * @param fields Array of field names
     * @returns {string}
     * @private
     */
    static _getFieldValue(object, fields) {
        if (!Array.isArray(fields) || fields.length === 0) {
            throw new Error('fields must be an array');
        }

        if (fields.length > 1) {
            return object.hasOwnProperty(fields[0]) ? Manifest._getFieldValue(object[fields[0]], fields.splice(1)) : '';
        } else {
            return object.hasOwnProperty(fields[0]) ? object[fields[0]] : '';
        }
    }


    /**
     * Get the value of the specified field name
     *
     * @param fieldName A field name, in dot notation (field.subfield.etc)
     * @returns {*}
     */
    getFieldValue(fieldName) {
        return Manifest._getFieldValue(this, fieldName.split('.'));
    }


    /**
     * Validate the current manifest
     *
     * @returns {boolean}
     */
    isValid() {
        return this.getMissingFields().length === 0;
    }


    /**
     * Return a list of required fields
     *
     * @returns {string[]}
     */
    static getRequiredFields() {
        return [
            'name',
            'description',
            'version',
            'icons.48',
            'developer.name',
            'launch_path',
            'default_locale',
            'activities.dhis.href'
        ];
    }


    /**
     * Return a list of optional fields
     *
     * @returns {string[]}
     */
    static getOptionalFields() {
        return [
            'icons.16',
            'icons.128',
            'developer.email',
            'developer.url',
            'developer.company'
        ];
    }


    /**
     * Return a list of all known and optional fields
     *
     * @returns {string[]} List of field names
     */
    static getAllKnownFields() {
        return Manifest.getRequiredFields().concat(Manifest.getOptionalFields());
    }


    /**
     * Recursively check if the specified field has a valid value
     *
     * @param target The target object to check
     * @param fields The name of the field to check, in dot notation (field.subfield)
     * @returns {boolean} True if the field exists and is not empty
     * @private
     */
    static _isValidField(target, fields) {
        if (Array.isArray(fields) && fields.length > 1) {
            const field = fields.shift();
            return target && target.hasOwnProperty(field) && isPlainObject(target[field]) && Manifest._isValidField(target[field], fields);
        }

        return !!target[fields[0]];
    }


    /**
     * Check if the specified fields on the target object exist and are not empty
     *
     * @param target The target object to check
     * @param fieldNames A list of field names to check, in dot notation (field.subfield)
     * @returns {string[]} A list of fields that are not present or have no value
     * @private
     */
    static _checkFields(target, fieldNames) {
        return fieldNames.filter(fieldName => {
            if (fieldName.indexOf('.') > 0) {
                const fields = fieldName.split('.');
                const object = fields.shift();

                return !(target.hasOwnProperty(object) && Manifest._isValidField(target[object], fields));
            }

            return !(target.hasOwnProperty(fieldName) && target[fieldName] !== undefined && target[fieldName] !== '');
        })
    }


    /**
     * Return a list of all available fields for the current manifest, with required fields sorted
     * before optional ones
     *
     * @returns {string[]} List of field names
     */
    getAllEmptyFields() {
        return Manifest._checkFields(this, Manifest.getRequiredFields())
            .concat(Manifest._checkFields(this, Manifest.getOptionalFields()));
    }

    /**
     * Checks the current manifest against the list of required fields
     *
     * @returns {string[]} List of required fields that are missing
     */
    getMissingFields() {
        return Manifest._checkFields(this, Manifest.getRequiredFields());
    }


    /**
     * Return a list of all known optional fields that aren't specified for the current manifest
     *
     * @returns {string[]}
     */
    getEmptyOptionalFields() {
        return Manifest._checkFields(this, Manifest.getOptionalFields());
    }


    /**
     * Return a JSON representation of the current manifest
     *
     * @param {boolean} ugly If true, no extra spaces or newlines will be returned
     */
    getJSON(ugly) {
        return JSON.stringify(this, null, ugly == true ? 0 : 2);
    }


    /**
     * Write the JSON representation of the current manifest to a file
     *
     * @param {String} filename
     * @param {boolean} ugly
     */
    write(filename, ugly) {
        try {
            fs.writeFileSync(filename, this.getJSON(ugly == true));
        } catch (e) {
            log.error('Failed to write to file:'.red, e.message);
            throw e;
        }
    }


    /**
     * Read npm package data from the specified file, typically package.json
     *
     * @param filename
     * @returns {{}}
     */
    static readPackageFile(filename) {
        try {
            const pkg = JSON.parse(fs.readFileSync(filename, 'utf8'));
            const out = {};
            if (pkg.name) out.name = pkg.name;
            if (pkg.version) out.version = pkg.version;
            if (pkg.description) out.description = pkg.description;
            if (pkg.author) out.developer = Manifest.parseAuthor(pkg.author);

            // Additional fields to support manifests as source
            if (pkg.icons) out.icons = Object.assign({}, pkg.icons);
            if (!out.developer && pkg.developer) out.developer = Object.assign({}, pkg.developer);
            if (pkg['launch_path']) out['launch_path'] = pkg['launch_path'];
            if (pkg['default_locale']) out['default_locale'] = pkg['default_locale'];
            if (pkg.activities) out.activities = Object.assign({}, pkg.activities);

            if (pkg.hasOwnProperty('manifest.webapp')) {
                Object.assign(out, pkg['manifest.webapp']);
            }

            return out;
        }
        catch (e) {
            log.error('Failed to read package file:'.red, e.message);
            process.exit(1);
        }
    }


    /**
     * Parse a "person field" as used by npm into an object consisting of
     * name, email and url
     *
     * @param {String} str
     * @returns {{name: String, email: String, url: String}}
     */
    static parseAuthor(str) {
        if (isPlainObject(str)) {
            return {
                name: str.name,
                email: str.email,
                url: str.url
            };
        }

        const author = getAuthorRegex().exec(str);
        if (!author) return {};
        const out = {name: author[1]};
        if (author[2] && author[2] !== '') out.email = author[2];
        if (author[3] && author[3] !== '') out.url = author[3];
        return out;
    }
}

module.exports = Manifest;
