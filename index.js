var Resource    = require('deployd/lib/resource')
, httpUtil      = require('deployd/lib/util/http')
, util          = require('util')
, AWS           = require('aws-sdk')
, fs            = require('fs')
, path          = require('path')
, debug		    = require('debug')('dpd-fileupload')
, formidable	= require('formidable')
, md5			= require('md5')
, mime		    = require('mime');

function S3Bucket(name, options) {
    Resource.apply(this, arguments);
    if (this.config.key && this.config.secret && this.config.bucket && this.config.endpoint) {

        this.s3 = new AWS.S3({
            forcePathStyle: true, // Configures to use subdomain/virtual calling format.
            endpoint: this.config.endpoint,
            region: 'us-east-1',
            signatureVersion: 'v4',
            signatureCache: false,
            credentials: {
                accessKeyId: this.config.key,
                secretAccessKey: this.config.secret,
            }
        });
    }
}
util.inherits(S3Bucket, Resource);
module.exports = S3Bucket;
S3Bucket.label = "S3 Space";

S3Bucket.prototype.clientGeneration = true;

S3Bucket.events = ["post", "put", "get", "delete"];
S3Bucket.basicDashboard = {
    settings: [{
        name: 'key'
        , type: 'string'
    }, {
        name: 'secret'
        , type: 'string'
    }, {
        name: 'bucket'
        , type: 'string'
    }, {
        name: 'endpoint'
        , type: 'string'
    }]
};

S3Bucket.prototype.handle = function (ctx, next) {
    var req = ctx.req
    , bucket = this
    , domain = {url: ctx.url, query:ctx.query};

    if (!this.s3) return ctx.done("Missing S3 configuration!");

    if (req.method === "GET") {
        if ( ctx.query.signedUrl == 'Put' ) {
            if (this.events.put) {
                this.events.put.run(ctx, domain, function(err) {
                    if (err) return ctx.done(err);
                    bucket.put(ctx, next);
                });
            } else {
                this.put(ctx, next);
            }
        } else {
            if (this.events.get) {
                this.events.get.run(ctx, domain, function(err) {
                    if (err) return ctx.done(err);
                    bucket.get(ctx, next);
                });
            } else {
                this.get(ctx, next);
            }
        }
    } else if (req.method === "DELETE") {
        if (this.events['delete']) {
            this.events['delete'].run(ctx, domain, function(err) {
                if (err) return ctx.done(err);
                bucket.delete(ctx, next);
            });
        } else {
            this.delete(ctx, next);
        }
    } else if (req.method === "POST") {
        
        if (this.events['post']) {
            this.events['post'].run(ctx, domain, function(err) {
                if (err) return ctx.done(err);
                bucket.post(ctx, next);
            });
        } else {
            this.post(ctx, next);
        }
    } else {
        next();
    }
};

// Upload a file to S3
S3Bucket.prototype.post = function (ctx, next) {
    
    var req = ctx.req;
    
    ctx.body = {};
    
    var form = new formidable.IncomingForm(),
        uploadDir = '/tmp',
        resultFiles = [],
        remainingFile = 0;

    form.uploadDir = uploadDir;

    form.parse(req)
    .on('progress', function(bytesReceived, bytesExpected) {
        // handle progress
    }).on('field', function(fieldName, fieldValue) {
        console.log('data', { name: 'field', key: fieldName, value: fieldValue });
    }).on('file', function(name, file) {
        console.log('data', { name: 'file', name, value: file });
    }).on('error', function(err) {
        return ctx.done(err);
    }).on('end', function() {
        //end process
        ctx.done({ statusCode: 200, message: "Succes not yet supported" });
    });

    return req.resume();
    
}

// get a signedUrl for get object into s3
S3Bucket.prototype.get = function (ctx, next) {
    // remove the first /
    var s3Key = ctx.url[0] == '/' ? ctx.url.substr(1) : ctx.url;

    var params = {
        Bucket: this.config.bucket,
        Key: s3Key,
        Expires: ctx.query.Expires,
    };

    this.s3.getSignedUrl('getObject', params, function(err, url){
        if (err) {
            return ctx.done(err);
        }
        if (ctx.query.returnFormat == 'Url') {
            // simple ajax to get url link
            ctx.done(null, url);
        } else {
            // redirect (can be used in <img src="/s3bucket/apple.jpg">)
            ctx.res.statusCode = 307;
            ctx.res.setHeader("Location", url);
            ctx.res.end(null, url);
        }
    });
}

// get a signedUrl for put object into s3
S3Bucket.prototype.put = function (ctx, next) {
    // remove the first /
    var s3Key = ctx.url[0] == '/' ? ctx.url.substr(1) : ctx.url;

    var params = {
        Bucket: this.config.bucket,
        Key: s3Key,
        Expires: ctx.query.Expires || 5*60, // default 5*60 seconds
        ContentType: ctx.query.ContentType, // required
    };
    if (ctx.query.ContentLength) {
        params.ContentLength = ctx.query.ContentLength;
    }

    this.s3.getSignedUrl('putObject', params, ctx.done);
}

// get a signedUrl for delete object into s3
S3Bucket.prototype.delete = function (ctx, next) {
    // remove the first /
    var s3Key = ctx.url[0] == '/' ? ctx.url.substr(1) : ctx.url;
    this.s3.deleteObject({
        Bucket: this.config.bucket,
        Key: s3Key,
    }, ctx.done);
}