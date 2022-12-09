var Resource    = require('deployd/lib/resource')
, httpUtil      = require('deployd/lib/util/http')
, util          = require('util')
, AWS           = require('aws-sdk')
, fs            = require('fs')
, path          = require('path')
, debug		    = require('debug')('dpd-fileupload')
, formidable	= require('formidable')
, md5			= require('md5')
, mime		    = require('mime')
, httpsClient   = require('http')
, querystring   = require('querystring');

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
    }, {
        name: 'deploydInstance'
        , type: 'string'
        , description: 'URL of the Deployd instance'
    }, {
        name: 'imgCollection'
        , type: 'string'
        , description: 'Name of the images collection'
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

    var postImageCallback = function(error, data, fileinfo) {
        console.log('postImageCallback() - hit');
        if (error) return ctx.done(err);

        const Bull = require('bull');

        const connectQueue = (name) => new Bull(name, {
            redis: { port: '6379', host: '127.0.0.1' }
        });

        const jobOptions = {
            // jobId, uncoment this line if your want unique jobid
            removeOnComplete: true, // remove job if complete
            // delay: 60000,
            attempts: 3 // attempt if job is error retry 3 times
        };
        
        const nameQueue = 'pulsmedia-img-sizes';

        var rendintions = [
            {
                name: "featured_big",
                focus: "auto",
                width: 750,
                height: 422,
                operation: "cover"
            },
            {
                name: "featured_medium",
                focus: "auto",
                width: 428,
                height: 241,
                operation: "cover"
            },
            {
                name: "featured_small",
                focus: "auto",
                width: 300,
                height: 169,
                operation: "cover"
            },
            {
                name: "square_big",
                focus: "auto",
                width: 750,
                height: 750,
                operation: "cover"
            },
            {
                name: "square_big",
                focus: "auto",
                width: 300,
                height: 300,
                operation: "cover"
            },
            {
                name: "vertical",
                focus: "auto",
                width: 422,
                height: 563,
                operation: "cover"
            },
            {
                name: "thumbnail",
                focus: "auto",
                width: 100,
                height: 100,
                operation: "cover"
            },
            {
                name: "inarticle_big",
                focus: "auto",
                width: 750,
                operation: "resize"
            },
            {
                name: "inarticle_small",
                focus: "auto",
                width: 428,
                operation: "resize"
            }
        ]

        console.log('postImageCallback data');
        console.log(JSON.parse(data));

        for (let i = 0; i < rendintions.length; i++) {
            const jobData = {
                imageId: JSON.parse(data).id,
                originalUrl: JSON.parse(data).originalUrl,
                rendintion: rendintions[i]
            }

            connectQueue(nameQueue).add(jobData, jobOptions);
        }

        return ctx.done(null, JSON.parse(data));
    }

    var postImage = function(data, fileinfo, callback) {
        console.log('postImage() - hit');
        // Build the post string from an object
        //var post_data = querystring.stringify(data);
        var post_data = JSON.stringify(data);
      
        // An object of options to indicate where to post to
        var post_options = {
            host: '165.227.143.113',
            port: '2403',
            path: '/images',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(post_data)
            }
        };
      
        // Set up the request
        var post_req = httpsClient.request(post_options, function(post_res) {
            post_res.setEncoding('utf8');
            /*
            post_res.on('data', function (chunk) {
                console.log('Response: ' + chunk);
            });
            */
            var body = ""
            post_res.on('data', function (chunk) {
                body += chunk // accumlate each chunk
            });
            post_res.on('end', function () {
                callback(null, body, fileinfo) // call the call back with complete response
            });

            post_res.on('error', function (e) {
                callback(e) // call the callback with error
            });
        });
      
        // post the data
        post_req.write(post_data);
        post_req.end();
      
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
            
            //console.log("formFileInfo");
            //console.log(formFileInfo);

            for (let i = 0; i < formFileInfo.files.length; i++) { 

                var postImageData = {
                    title: formFileInfo.fields.find(({title}) => title).title,
                    description: formFileInfo.fields.find(({description}) => description).description,
                    sourceSiteUrl: formFileInfo.fields.find(({sourceSiteUrl}) => sourceSiteUrl).sourceSiteUrl,
                    originalUrl: formFileInfo.files[i].cdn
                }

                console.log("postImageData");
                console.log(postImageData);

                postImage(postImageData, formFileInfo, postImageCallback);
            }
            
            // 
            // return twicPicsProcess(formFileInfo);
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
