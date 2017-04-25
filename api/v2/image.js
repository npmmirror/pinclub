var models = require('../../models');
var TopicModel = models.Topic;
var TopicProxy = require('../../proxy').Topic;
var TopicLike = require('../../proxy').TopicLike;
var TopicBoard = require('../../proxy').TopicBoard;
var UserProxy = require('../../proxy').User;
var UserModel = models.User;
var ReplyProxy = require('../../proxy').Reply;
var config = require('../../config');
var eventproxy = require('eventproxy');
var structureHelper = require('../../common/structure_helper');

/**
 * @api {get} /v2/images/sim 相似图片列表
 * @apiDescription
 * 获取本站相似图片列表, 根据hamming距离算法计算.
 * @apiName simImages
 * @apiGroup images
 *
 * @apiParam {String} id 查询相似的图片id
 * @apiParam {String} sid 页数
 * @apiParam {Number} limit 要查询的图片数量
 *
 * @apiPermission none
 * @apiSampleRequest /v2/images/sim
 *
 * @apiVersion 2.0.0
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 */
exports.sim = function (req, res, next) {
    if (!req.query.id) {
        return res.status(500).send({success: false, error_msg: "必要参数id未传."});
    }
    // 需从哪个id开始继续向下找
    if (!req.query.sid) {
        return res.status(500).send({success: false, error_msg: "必要参数sid未传."});
    }
    var limit = 3;
    if (req.query.limit && req.query.limit <= 10) {
        limit = req.query.limit;
    }
    var topicId = req.query.id;
    var sId = req.query.sid;
    var ep = new eventproxy();
    ep.fail(next);

    TopicProxy.getTopicById(topicId, function (err, topic, tags) {
        if (err) {
            return next(err);
        }
        if (!topic) {
            res.status(404);
            return res.send({success: false, error_msg: '图片不存在'});
        }
        var options = {limit: limit, sort: '-_id'};
        TopicProxy.getTopicsByQuery({type:'image', _id:{$lt:sId}, $where: "hammingDistance(this.image_hash, '" + topic.image_hash + "') < 20"}, options, ep.done('topics', function (topics) {
            return topics;
        }));

    });
    ep.all('topics', function (topics) {
        topics = topics.map(function (topic) {
            return structureHelper.topic(topic);
        });

        res.send({success: true, data: topics});
    });
};

/**
 * @api {post} /v2/images/like 喜欢图片
 * @apiDescription
 * 喜欢某图片
 * @apiName likeImage
 * @apiGroup images
 *
 * @apiUse ApiHeaderType
 * @apiParam {String} id 要喜欢的图片id
 *
 * @apiPermission none
 * @apiSampleRequest /v2/images/like
 *
 * @apiVersion 2.0.0
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 */
exports.like = function (req, res, next) {
    if (!req.body.id) {
        return res.status(500).send({success: false, error_msg: "必要参数id未传."});
    }

    var ep = new eventproxy();
    ep.fail(next);
    var topicId = req.body.id;
    var currentUser = req.session.user;
    TopicProxy.getTopicById(topicId, function (err, topic) {
        if (err) {
            return next(err);
        }
        if (!topic) {
            res.status(404);
            return res.send({success: false, error_msg: '图片不存在'});
        }
        TopicLike.getTopicLike(currentUser.id, topic._id, function (err, doc) {
            if (err) {
                return next(err);
            }
            if (doc) {
                return ep.emit('unlike_topic', topic);
                //res.json({success: false});
                //return;
            }
            ep.emit('like_topic', topic);
            //TopicLike.newAndSave(currentUser.id, topic._id, function (err) {
            //    if (err) {
            //        return next(err);
            //    }
            //    res.json({success: true});
            //});
            //UserProxy.getUserById(currentUser.id, function (err, user) {
            //    if (err) {
            //        return next(err);
            //    }
            //    user.like_image_count += 1;
            //    user.save();
            //});
            //
            //topic.like_count += 1;
            //topic.save();
        });

    });

    ep.on('like_topic', function(topic) {
        TopicLike.newAndSave(currentUser.id, topic._id, function (err) {
            if (err) {
                return next(err);
            }
            res.json({success: true});
        });
        UserProxy.getUserById(currentUser.id, function (err, user) {
            if (err) {
                return next(err);
            }
            user.like_image_count += 1;
            user.save();
        });

        topic.like_count += 1;
        topic.save();
    });

    ep.on('unlike_topic', function(topic) {
        TopicLike.remove(currentUser.id, topic._id, function (err, removeResult) {
            if (err) {
                return next(err);
            }
            if (removeResult.result.n == 0) {
                return res.json({success: false})
            }

            UserProxy.getUserById(currentUser.id, function (err, user) {
                if (err) {
                    return next(err);
                }
                user.like_image_count -= 1;
                user.save();
            });

            topic.like_count -= 1;
            topic.save();

            res.json({success: true});
        });
    });

};

/**
 *
 * @api {post} /v2/images/get Get图片
 * @apiDescription
 * Get某图片
 * @apiName getImage
 * @apiGroup images
 *
 * @apiUse ApiHeaderType
 * @apiParam {String} topic_id 要 Get 的图片 id
 * @apiParam {String} board_id 放入 Board 的 id
 * @apiParam {String} [desc] 描述
 * @apiParam {String[]} [tags] 标签
 *
 * @apiPermission none
 * @apiSampleRequest /v2/images/get
 *
 * @apiVersion 2.0.0
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 */
exports.getImage = function (req, res, next) {
    req.checkBody({
        'topic_id': {
            notEmpty: {
                options: [true],
                errorMessage: 'topic_id 不能为空'
            }
        },
        'board_id': {
            notEmpty: {
                options: [true],
                errorMessage: 'board_id 不能为空'
            }
        }
    });
    var ep = new eventproxy();
    var topic_id = req.body.topic_id;
    var board_id = req.body.board_id;
    var desc = req.body.desc;
    var currentUser = req.session.user;
    if (req.validationErrors()) {
        return res.status(400).json({success: false, err_message: '参数验证失败', err: req.validationErrors()}).end();
    }

    TopicBoard.getTopicBoard(currentUser.id, topic_id, function (err, topicBoard) {
        if (err) {
            return next(err);
        }
        if (topicBoard && topicBoard.id === board_id) {
            res.json({success: false});
            return;
        }

        if (topicBoard) {
            topicBoard.board_id = board_id;
            topicBoard.desc = desc || null;
            topicBoard.save(function (err) {
                if (err) {
                    return next(err);
                }

                //res.send({
                //    success: true,
                //    topic_id: topicBoard.id
                //});
                ep.emit('get_image_success',topicBoard );
            });
            ep.on('get_image_success', function(topicBoard){
                res.send({
                    success: true,
                    topic_id: topicBoard.id
                });
            });
        } else {
            TopicBoard.newAndSave(currentUser.id, topic_id, board_id, desc || null, null, function (err, topicBoard) {
                if (err) {
                    return next(err);
                }

                ep.emit('get_image_success', topicBoard);
                //res.json({success: true});
            });
            UserProxy.getUserById(currentUser.id, function (err, user) {
                // TODO 增加 err 的错误校验, 返回对应的错误信息
                user.get_image_count += 1;
                user.save();
                ep.emit('user_count');
            });
            TopicProxy.getTopicById(topic_id, function (err, topic) {
                // TODO 增加 err 的错误校验, 返回对应的错误信息
                topic.geted_count += 1;
                topic.save();
                ep.emit('topic_count');
            });
            ep.all('get_image_success', 'user_count', 'topic_count', function(topicBoard){
                res.send({
                    success: true,
                    topic_id: topicBoard.id
                });
            });
        }
    });

};