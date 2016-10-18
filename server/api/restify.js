'use strict'

const _ = require('lodash')
const logger = require('./../lib/logger')
const util = require('./../lib/util')
const Joi = require('joi')

/**
 * Joi validation object for limit query parameter in url
 * @returns {*}
 * @private
 */
function _JoiLimit() {
    return Joi.number().integer()
        .min(1).max(1000)
        .default(10)
        .description('limit. min = 1, max = 1000')
}

/**
 * Joi validation object for offset query parameter in url
 * @returns {*}
 * @private
 */
function _JoiOffset() {
    return Joi.number().integer()
        .min(0)
        .default(0)
        .description('offset. min = 0')
}

/**
 * Joi validation object for fields query parameter in url
 * @returns {*}
 * @private
 */
function _JoiFields() {
    const description =
        'You can include or exclude fields in response. Fields should be separated by colon. ' +
        'To exclude field, just add in front of it -, for example: <code>-firstName,-lastname</code>'

    return Joi.string().regex(/^[a-zA-Z0-9_,]+$/)
        .default('')
        .description(description)
}

/**
 * Generate object from fields query parameter in url to select fields from mongodb.
 * To include field just add it name, to exclude field need to prepend it with sign -.
 * Fields should be separated by colon.
 * For example, for http:host.com/api?fields=name,age,-id
 * it will return {name: 1,age: 1, id: 0}
 * @param Model
 * @param request
 * @returns {{}}
 * @private
 */
function _getSelectObjFromFieldsInUrl(Model, request) {
    const urlFieldsStr = _.get(request.query, 'fields', '')
    const urlFields = urlFieldsStr.split(',').filter(value => value)

    //exit if empty fields query in url
    const result = {}
    if(!urlFields.length) {
        return result
    }

    const modelFields = util.getAllModelFields(Model)

    _.forEach(modelFields, (field) => {
        if(_.includes(urlFields, field)) {
            result[field] = 1
        }

        else if(_.includes(urlFields, `-${field}`)) {
            result[field] = 0
        }
    })

    return result
}

/**
 * Generate query object to make query to mongodb.
 * For example, for url http://host.com/api?firstname=bob&age=26
 * it will return {firstname='bob', age='26'}
 * @param Model
 * @param request
 * @returns {{}}
 * @private
 */
function _getQueryObjFromFieldsInUrl(Model, request) {
    const fields = util.getSchemaModelFields(Model)
    const queryDb = {}

    _.forEach(fields, (field) => {
        let fieldValue = request.query[field]

        if(fieldValue === '' || fieldValue === undefined) {
            return
        }

        queryDb[field] = request.query[field]
    })

    return queryDb
}

/**
 * POST /modelname
 *
 * Create post route for Model.
 * @param Model
 * @returns {{path: *, method: string, handler: function, config: {}}}
 * @private
 */
function _postRoute(Model) {
    const modelName = util.getModelName(Model)

    function postHandler (request, reply) {
        let data = request.payload
        let user = new Model(data)

        user.save()
            .then(reply)
            .catch((err) => {
                reply(err)
                logger.error(err)
            })
    }

    return {
        path: `/${modelName}`, method: 'POST', handler: postHandler, config: {
            description: `Create new ${modelName}`,
            tags: ['api'],
            validate: {
                payload: Model.joiValidate
            }
        }
    }
}

/**
 * GET /modelname/{id}
 *
 * Get model instance by Id
 * @param Model
 * @returns {{path: *, method: string, handler: function, config: {}}}
 * @private
 */
function _getRoute(Model) {
    const modelName = util.getModelName(Model)
    const idRegexp = util.getMongoIdRegexp()

    function getHandler(request, reply) {
        const id = request.params.id
        const select = _getSelectObjFromFieldsInUrl(Model, request)

        Model.findById(id)
            .select(select)
            .then(reply)
            .catch((err) =>{
                reply(err)
                logger.error(err)
            })
    }

    return {
        path: `/${modelName}/{id}`, method: 'GET', handler: getHandler, config: {
            description: `Get ${modelName} instance by id`,
            tags: ['api'],
            validate: {
                params: {
                    id: Joi.string().regex(idRegexp)
                },
                query: {
                    fields: _JoiFields()
                }
            }
        }
    }
}

/**
 * PUT /modelname/{id}
 *
 * Update model instance by Id
 * @param Model
 * @returns {{path: *, method: string, handler: putHandler, config: object}}
 * @private
 */
function _putRoute(Model) {
    const modelName = util.getModelName(Model)
    const idRegexp = util.getMongoIdRegexp()

    function putHandler(request, reply) {
        const id = request.params.id
        const data = request.payload
        const options = {new: true} //Note: by default it is false

        Model.findByIdAndUpdate(id, data, options)
            .then(reply)
            .catch((err) =>{
                reply(err)
                logger.error(err)
            })
    }

    return {
        path: `/${modelName}/{id}`, method: 'PUT', handler: putHandler, config: {
            description: `Update ${modelName} instance by id`,
            tags: ['api'],
            validate: {
                params: {
                    id: Joi.string().regex(idRegexp)
                },
                payload: Model.joiValidate
            }
        }
    }
}

/**
 * DELETE /modelname/{id}
 *
 * Delete model instance by Id
 * @param Model
 * @returns {{path: *, method: string, handler: deleteHandler, config: *}}
 * @private
 */
function _deleteRoute(Model) {
    const modelName = util.getModelName(Model)
    const idRegexp = util.getMongoIdRegexp()

    function deleteHandler(request, reply) {
        const id = request.params.id

        Model.remove({_id: id})
            .then(reply)
            .catch((err) =>{
                reply(err)
                logger.error(err)
            })
    }

    return {
        path: `/${modelName}/{id}`, method: 'DELETE', handler: deleteHandler, config: {
            description: `Delete ${modelName} instance by id`,
            tags: ['api'],
            validate: {
                params: {
                    id: Joi.string().regex(idRegexp)
                }
            }
        }
    }
}

/**
 * GET /modelname/count
 *
 * Calculate count instances in collection. There is also ability to add some condition in query string
 * @param Model
 * @returns {{path: *, method: string, handler: countHandler, config: *}}}
 * @private
 */
function _countRoute(Model) {
    const modelName = util.getModelName(Model)

    function countHandler(request, reply) {
        const queryObj = _getQueryObjFromFieldsInUrl(Model, request)
        Model.count(queryObj)
            .then(reply)
            .catch((err) =>{
                reply(err)
                logger.error(err)
            })
    }

    return {
        path: `/${modelName}/count`, method: 'GET', handler: countHandler, config: {
            description: `Return count instances in ${modelName} model`,
            tags: ['api'],
            validate: {
                query: Model.joiValidate
            }
        }
    }
}

/**
 * GET /modelname/list
 *
 * Get list of collection instances
 * @param Model
 * @returns {{path: *, method: string, handler: listHandler, config: *}}
 * @private
 */
function _listRoute(Model) {
    const modelName = util.getModelName(Model)

    function listHandler(request, reply) {
        const limit = request.query.limit
        const offset = request.query.offset
        const select = _getSelectObjFromFieldsInUrl(Model, request)

        Model.find({})
            .select(select)
            .limit(limit)
            .skip(offset)
            .then(reply)
            .catch((err) =>{
                reply(err)
                logger.error(err)
            })
    }

    return {
        path: `/${modelName}/list`, method: 'GET', handler: listHandler, config: {
            description: `Return list of ${modelName} instances`,
            tags: ['api'],
            validate: {
                query: {
                    limit: _JoiLimit(),
                    offset: _JoiOffset(),
                    fields: _JoiFields()
                }
            }
        }
    }
}

/**
 * GET /modelname/find
 *
 * Return list of collection instances by given criteria
 * @param Model
 * @returns {{path: *, method: string, handler: findHandler, config: *}}
 * @private
 */
function _findRoute(Model) {
    const modelName = util.getModelName(Model)

    function findHandler(request, reply) {
        const limit = request.query.limit
        const offset = request.query.offset

        const queryObj = _getQueryObjFromFieldsInUrl(Model, request)
        const select = _getSelectObjFromFieldsInUrl(Model, request)

        return Model.find(queryObj)
            .select(select)
            .limit(limit)
            .skip(offset)
            .then(reply)
            .catch((err) =>{
                reply(err)
                logger.error(err)
            })
    }

    return {
        path: `/${modelName}/find`, method: 'GET', handler: findHandler, config: {
            description: `Return list of ${modelName} instances`,
            tags: ['api'],
            validate: {
                query: _.assign({}, Model.joiValidate, {
                    limit: _JoiLimit(),
                    offset: _JoiOffset(),
                    fields: _JoiFields()
                })
            }
        }
    }
}

/**
 * Return restify routes for Model
 * @param Model
 * @returns {*[]}
 */
function restify(Model) {
    return [
        _postRoute(Model),
        _getRoute(Model),
        _putRoute(Model),
        _deleteRoute(Model),
        _countRoute(Model),
        _listRoute(Model),
        _findRoute(Model)
    ]
}

module.exports = {
    /*private methods*/
    _JoiLimit,
    _JoiOffset,
    _JoiFields,
    _getSelectObjFromFieldsInUrl,
    _getQueryObjFromFieldsInUrl,
    _postRoute,
    _getRoute,
    _putRoute,
    _deleteRoute,
    _countRoute,
    _listRoute,
    _findRoute,
    /*public methods*/
    restify
}