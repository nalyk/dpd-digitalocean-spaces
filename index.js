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
        thisConfig = this.config;
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
        uploadDir = '/tmp';

    var formFileInfo = {};
    var formFields = [];
    var formFiles = [];

    form.uploadDir = uploadDir;

    var uploadedFiles = [];
    var uploadInfo = {};

    var uploadCounter = 0;

    var checkUploadedCount = function(data) {
        console.log('checkUploadedCount() - HIT!');
        console.log('checkUploadedCount() - uploadCounter='+uploadCounter);
        console.log('checkUploadedCount() - fileInfo.files.length='+fileInfo.files.length);
        
        if (uploadCounter < fileInfo.files.length) {
            setReturnInfo(data);
        } else {
            uploadInfo.fields = fileInfo.fields;
            uploadInfo.files = uploadedFiles;
            return ctx.done(null, uploadInfo);
        }
    }

    var setReturnInfo = function(data) {
        console.log('setReturnInfo() - HIT!');
        uploadCounter++;
        uploadedFiles.push(data);
    }

    var s3UploadProcessed = function(fileInfo) {
        console.log('s3UploadProcessed() - HIT!');
        //console.log('function s3UploadProcessed');
        //console.log(fileInfo);

        for (let i = 0; i < fileInfo.files.length; i++) {
            var localFile = fileInfo.files[i];

            var params = {
                Bucket: thisConfig.bucket,
                Key: 'images/' + (new Date()).toISOString().split('T')[0] + '/' + md5(localFile.originalFilename) + path.extname(localFile.originalFilename),
                Body: fs.createReadStream(localFile.filepath),
                ACL: "public-read"
            };
        
            var options = {
                partSize: 10 * 1024 * 1024, // 10 MB
                queueSize: 10
            };
        
            thisS3.upload(params, options, function (err, data) {
                if (!err) {
                    //console.log('uplod module success');
                    //console.log(data); // successful response
                    //return ctx.done(null, data);
                    console.log('thisS3.upload() - HIT!');
                    checkUploadedCount(data);
                    //uploadedFiles.push(data);
                } else {
                    console.log('uplod module error');
                    console.log(err); // an error occurred
                    return ctx.done("Upload S3 error!");
                }
            });
        }        
        
        //return ctx.done(null, uploadInfo);
    }
    
    form.parse(req)
    .on('field', function(fieldName, fieldValue) {
        // console.log('field', { key: fieldName, fieldValue: fieldValue });
        var fieldObject = {};
        fieldObject[fieldName] = fieldValue;
        formFields.push(fieldObject);
    }).on('file', function(name, file) {
        //console.log('file', { name: name, file: file });
        formFiles.push(file);
    }).on('error', function(err) {
        return ctx.done(err);
    }).on('end', function() {
        formFileInfo.files = formFiles;
        formFileInfo.fields = formFields;
        return s3UploadProcessed(formFileInfo);
    });

    req.resume();
}
