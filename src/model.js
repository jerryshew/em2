require('whatwg-fetch')
require('es6-promise').polyfill();

const METHODS = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH']

const trimFieldSlot = (item) => {
    let newItem = { type: item.type, default: item.default }
    if (item.hasOwnProperty('type') &&  [undefined, null].indexOf(item.type) === -1) {
        if ([undefined, null].indexOf(item.default) !== -1 || item.default.constructor !== item.type) {
            newItem.default = item.type.call(null);
        }
    }
    return newItem
}

const pushFieldNames = (fieldNames, name) => {
    let names = fieldNames.slice(0)
    if (names.indexOf(name) === -1) names.push(name)
    return names
}

// clear fields
const clearFields = (fields) => {
    let newFields = {}
    let fieldNames = []

    if (!fields) return { fields: newFields, fieldNames } 

    if (fields.constructor === Array) {
        fields.map(field => {
            if (field.constructor === String) {
                newFields[field] = trimFieldSlot(field)
                fieldNames = pushFieldNames(fieldNames, field)
            } else if (field.constructor === Object && field.hasOwnProperty('name')){
                let name = field.name
                newFields[name] = trimFieldSlot(field)
                fieldNames = pushFieldNames(fieldNames, name)
            }
        })
    } else if(fields.constructor === Object) {
        Object.keys(fields).map(name => {
            if (fields.hasOwnProperty(name)) {
                newFields[name] = trimFieldSlot(fields[name])
                fieldNames = pushFieldNames(fieldNames, name)
            }
        })
    }

    return { fields: newFields, fieldNames }
}

// filter url 
const filterUrl = (url) => {
    if (typeof url !== 'string') url = '';
    
    // start with '/', but not http or https
    if (url.charAt(0) !== '/') {
        if (url.indexOf('http') !== 0 && url.indexOf('https') !== 0) {
            url = `/${url}`
        }
    }
    
    // if last is '/', remove it!
    let l = url.length - 1;
    if(l > 0 && url.charAt(l) === '/')  url = url.slice(0, l)

    return url
}

// init config, temporarily set primary key
const initConfig = (config) => {
    let _config = {}
    if (config) {
        let {pkey, parseData, exception} = config
        if (typeof pkey === 'string' && pkey) {
            _config.pkey = pkey.trim()
        }
        if (typeof parseData === 'function') {
            _config.parseData = parseData
        }

        if (typeof exception === 'function') {
            _config.exception = exception
        }
    }
    return _config
}

// serialize params object to ?a=1&b=2
const serialize = (params) => {
    if (params && params.constructor === Object) {
        if (Object.getOwnPropertyNames(params).length === 0) {
            return ''
        }
        return Object.keys(params).reduce((prev, current, index) => {
            if ([undefined, null].indexOf(params[current]) !== -1) {
                return prev
            }
            if (prev.slice(-1) === '?') {
                return `${prev}${current}=${params[current]}`
            }
            return `${prev}&${current}=${params[current]}`
        }, '?')
    }
    return ''
}


// main
const em2 = (model, config = {}) => {
    if (model === undefined || model === null || model.constructor !== Object) {
        console.error('model is invalid, model should be an object')
        return {}
    }

    if (!model.hasOwnProperty('name')) {
        console.error('model needs a name, could not register to model manager')
        return
    }
    
    // init config, Model methods
    model = Object.assign({fieldNames: null}, model, em2.prototype, initConfig(config))
    
    // format url, fields
    model.url = filterUrl(model.url)
    let {fields, fieldNames} = clearFields(model.fields)
    model.fields = fields
    model.fieldNames = fieldNames
    
    // register Model and ModelNames
    if (model.hasOwnProperty('name')) {
        em2.models[model.name] = model
        em2.modelNames.push(model.name)
    }
    return model
}

// init em2 model, modelNames
em2.models = {}
em2.modelNames = []

// trim params by model's fields
em2.trimParams = (modelName, params) => {
    let model = em2.models[modelName]
    if (!model) {
        console.warn('model is not defined')
        return params
    }

    let {fields} = model;
    Object.keys(fields).forEach(name => {
        let format = fields[name]
        if (params.hasOwnProperty(name)) {
            let value = params[name]
            let hasType = [undefined, null].indexOf(format.type) === -1
            let hasVal = [undefined, null].indexOf(value) === -1
            
            // field has no type, and params's field has no value, remove key
            if (!hasType && !hasVal) delete params[name]
            
            // field has type, and params's field has no value or value type wrong, filled with default
            if (hasType && (!hasVal || value.constructor !== format.type)) {
                params[name] = [undefined, null].indexOf(value) === -1 ? format.default : format.type.call(null)
            }

        } else {
            if (format.type) params[name] = format.type.call(null)
        }
    })
    return params
}

// remove register
em2.drop = (name) => {
    delete em2.models[name]
    let {modelNames} = em2
    return modelNames.splice(modelNames.indexOf(name), 1)
}

// reslove Data api
const fetchData = function(url, params = {}){
    params = params || {};
    let headers = params.headers || {}

    if (!params.hasOwnProperty('method')) {
        params.method = 'GET';
    }

    if (!headers['Content-Type']) {
        headers['Content-Type'] =  'application/x-www-form-urlencoded;charset=UTF-8'
    }
    if (!headers['X-Requested-With']) {
        headers['X-Requested-With'] = 'XMLHttpRequest'
    }
    if (!params.credentials) {
        params.credentials = 'same-origin'
    }
    params.headers = headers

    return new Promise((resolve, rejected) => {
        fetch(url, params).then(response => {
            response.status >= 200 && response.status < 300 ?  resolve(response.json()) : rejected(response)
        }).catch(rejected)
    })
}

// res injection
const resInject = function(handler){
    let that = this || {}
    let {parseData, exception} = that
    if (typeof parseData === 'function') {
        return handler.then(data => {
            return parseData.call(this, data) 
        }).catch(error => {
            if (typeof exception === 'function') {
                return exception.call(this, error)
            }
            return error
        })
    }
    return handler.catch(error => {
        if (typeof exception === 'function') {
            return exception.call(this, error)
        }
        return error
    })
}

// nested url and params seperate
const shuntNestedParams = function(obj){
    if ([undefined, null].indexOf(obj) !== -1) {
        throw('参数错误')
    }

    let s_url = Object.keys(obj).reduce((prev, name) => {
        if (obj.hasOwnProperty(name)) {
            let reg = new RegExp('/:' + name, 'gi')
            if (prev.match(reg)) {
                return prev.replace(reg, '/' + obj[name])
            }
        }
        return prev
    }, this.url)

    return {
        s_url,
        s_params: obj
    }
}

const reqDispatch = function(method = 'OPTIONS', url = '', params = {}){
    method = method.toUpperCase()
    if (METHODS.indexOf(method) === -1) method = 'OPTIONS'
    if (['HEAD', 'GET'].indexOf(method) !== -1) {
        return resInject.call(this, fetchData(`${url}${serialize(params)}`))
    }
    if (method === 'DELETE') {
        return resInject.call(this, fetchData(`${url}${serialize(params)}`, {method: 'DELETE'})) 
    }

    params = Object.assign({method}, {body: serialize(params).slice(1)})
    return resInject.call(this, fetchData(url, params))
}

// prototype
em2.prototype = {
    pkey: '_id',
    nested(){
        return this.url.indexOf(':') !== -1
    },
    findOne(_id, params = {}) {
        // nested model
        if (this.nested()) {
            if ([undefined, null].indexOf(_id) === -1 && _id.constructor === Object) {
                let {s_url} = shuntNestedParams.call(this, _id)
                let pkey = _id[this.pkey]
                delete _id[this.pkey]
                return reqDispatch.call(this, 'GET', `${s_url}/${pkey}`, params)
            }
            throw(`wrong params, first argument should be an object, and has property in model's url(just like :id) and ${this.pkey}`)
        }

        // basic
        if ([undefined, null].indexOf(_id) === -1 && _id.constructor === Object) {
            let pkey = _id[this.pkey]
            delete _id[this.pkey]
            return reqDispatch.call(this, 'GET', `${this.url}/${pkey}`, _id)
        }

        return reqDispatch.call(this, 'GET', `${this.url}/${_id}`, params)
    },

    find(params) {
        // nested
        if (this.nested()) {
            let {s_url, s_params} = shuntNestedParams.call(this, params)
            delete s_params[this.pkey]
            return reqDispatch.call(this, 'GET', s_url, s_params)
        }
        // basic
        return reqDispatch.call(this, 'GET', this.url, params)
    },

    update(params) {
        let _id = params[this.pkey]
        delete params[this.pkey]

        if (this.nested()) {
            let {s_url, s_params} = shuntNestedParams.call(this, params)
            return reqDispatch.call(this, 'PUT', `${s_url}/${_id}`, em2.trimParams(this.name, s_params))
        }
        return reqDispatch.call(this, 'PUT', `${this.url}/${_id}`, em2.trimParams(this.name, params))
    },
    
    create(params) {
        delete params[this.pkey]
        if (this.nested()) {
            let {s_url, s_params} = shuntNestedParams.call(this, params)
            return reqDispatch.call(this, 'POST', s_url, em2.trimParams(this.name, s_params))
        }
        return reqDispatch.call(this, 'POST', this.url, em2.trimParams(this.name, params))
    },

    save(params) {
        return params && params[this.pkey] ? this.update(params) : this.create(params)
    },

    destroy(params) {
        let _id = params[this.pkey]
        delete params[this.pkey]

        if (this.nested()) {
            let {s_url, s_params} = shuntNestedParams.call(this, params)
            return reqDispatch.call(this, 'DELETE', `${s_url}/${_id}`, s_params)
        }
        return reqDispatch.call(this, 'DELETE', `${this.url}/${_id}`, params)
    },
    request(method, url, params) {
        if (arguments.length < 2 || typeof method !== 'string' || typeof url !== 'string') {
            return console.error('params wrong, need three arguments: method, url, params(optional query and fetch setting)')
        }

        return reqDispatch.call(this, method, url, params)
    }
}

module.exports = em2
