'use strict';
module.exports = () => ({
  metadata: {
    platform: 'tapnow',
    title: 'TapNow 合成验收',
    author: '测试作者',
    inputUrl: 'https://app.tapnow.plus/home/taptv/9/fixture'
  },
  snapshot: {
    nodes: [
      {
        id: 'upload',
        type: 'image',
        position: { x: 0, y: 0 },
        data: {
          type: 'upload',
          title: '角色',
          prompt: '',
          src: 'https://files.tapnow.media/role',
          __metadata: { url: 'https://files.tapnow.media/role', width: 1600, height: 900 }
        }
      },
      {
        id: 'vocal',
        type: 'audio',
        data: {
          type: 'upload',
          title: '音色',
          prompt: '音色.wav',
          params: { model: 'music-2.6' },
          src: 'https://files.tapnow.media/vocal'
        }
      },
      { id: 'text', type: 'text', data: { title: '场景', content: '画布文本' } },
      {
        id: 'video',
        type: 'video',
        data: {
          type: 'generate',
          title: '视频',
          prompt: 'Image1 进入森林，{{Audio 1}} 说话',
          params: {
            model: 'seedance-2.5',
            modelType: 'reference_to_video',
            aspectRatio: '16:9',
            duration: 30,
            resolution: '720p',
            times: 1,
            generateAudio: true,
            images: ['https://files.tapnow.media/role'],
            audios: ['https://files.tapnow.media/vocal'],
            texts: [{ nodeId: 'text', content: '参数中的文本' }]
          },
          src: 'https://files.tapnow.media/video',
          options: ['https://files.tapnow.media/video'],
          taskInfo: { status: 'completed' },
          __metadata: {
            url: 'https://files.tapnow.media/video',
            width: 1280,
            height: 720,
            duration: 30
          }
        }
      },
      {
        id: 'image',
        type: 'image',
        data: {
          type: 'generate',
          title: '图片',
          prompt: '森林',
          params: { model: 'image-model', modelType: 'text_to_image' },
          src: 'https://files.tapnow.media/generated'
        }
      },
      {
        id: 'upscale',
        type: 'video',
        data: {
          type: 'upscale',
          title: '视频增强',
          prompt: '',
          src: 'https://files.tapnow.media/upscaled'
        }
      },
      {
        id: 'crop',
        type: 'image',
        data: {
          type: 'edit',
          editSubType: 'cutout',
          title: '裁剪',
          prompt: '',
          src: 'https://files.tapnow.media/crop'
        }
      },
      {
        id: 'failed',
        type: 'video',
        data: {
          type: 'generate',
          prompt: '未完成',
          src: 'https://files.tapnow.media/not-output',
          taskInfo: { status: 'failed' }
        }
      },
      { id: 'comment', type: 'comment', data: { title: 'Comment', comments: [] } }
    ],
    edges: [
      { id: 'e1', source: 'upload', target: 'video', data: { order: 1 } },
      { id: 'e2', source: 'vocal', target: 'video', data: { order: 2 } },
      { id: 'e3', source: 'text', target: 'video' }
    ]
  }
});
