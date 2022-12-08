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


var thisConfig,
    thisS3;
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
        /* dirty formidable hack */
        thisConfig = this.config;
        thisS3 = this.s3;
    }
}
util.inherits(S3Bucket, Resource);
module.exports = S3Bucket;
S3Bucket.label = "S3 Space";

S3Bucket.prototype.clientGeneration = true;

S3Bucket.events = ["post"];
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

    if (req.method === "POST") {    
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

    var formFileInfo = {};
    var formFields = [];
    var formFiles = [];

    form.uploadDir = uploadDir;

    var twicPicsProcess = function(formFileInfo) {
        console.log('twicPicsProcess() - hit');
        
        var files = formFileInfo.files;
        console.log(files);

        return ctx.done(null, formFileInfo);
    }

    var formProcessDone = function(err, fileInfo, fields) {
        console.log('formProcessDone() - hit');
        if (err) return ctx.done(err);
        
        resultFiles.push(fileInfo);
        
        remainingFile--;
        
        if (remainingFile === 0) {
            console.log('formProcessDone() - remainingFile === 0');
            formFileInfo.fields = fields;

            resultFiles.forEach(object => {
                object.cdn = object.Location.replace("digitaloceanspaces.com", "cdn.digitaloceanspaces.com");
            });
            formFileInfo.files = resultFiles;
            
            return twicPicsProcess(formFileInfo);
        }
    }

    var s3UploadFile = function(file, fields) {
        console.log('s3UploadFile() - hit');

        var params = {
            Bucket: thisConfig.bucket,
            Key: 'images/' + (new Date()).toISOString().split('T')[0] + '/' + md5(file.originalFilename) + path.extname(file.originalFilename),
            Body: fs.createReadStream(file.filepath),
            ContentType: file.mimetype,
            ACL: "public-read"
        };
    
        var options = {
            partSize: 10 * 1024 * 1024, // 10 MB
            queueSize: 10
        };
    
        thisS3.upload(params, options, function (err, data) {
            if (!err) {
                console.log('s3UploadFile() - thisS3.upload() - data');
                console.log(data);
                formProcessDone(null, data, fields);
            } else {
                console.log('upload module error');
                console.log(err);
                return ctx.done("Upload S3 error!");
            }
        });
    }

    form.parse(req)
    .on('field', function(fieldName, fieldValue) {
        var fieldObject = {};
        fieldObject[fieldName] = fieldValue;
        formFields.push(fieldObject);
    }).on('file', function(name, file) {
        s3UploadFile(file, formFields);
    }).on('fileBegin', function(name, file) {
        remainingFile++;
    }).on('error', function(err) {
        return formProcessDone(err, null, null);
    });

    return req.resume();
}
