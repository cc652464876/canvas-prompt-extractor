'use strict';
// Field shapes observed on 2026-10-09 in the editable and community preview of
// 琥珀计划. IDs, prompts, media URLs and identity are synthetic.
module.exports = function fixture() {
  return {
    metadata: {
      platform: 'rhtv',
      title: 'RHTV 合成验收',
      author: '测试作者',
      inputUrl: 'https://rhtv.runninghub.cn/projects/canvas/camp/fixture'
    },
    snapshot: {
      nodes: [
        {
          id: 'uploaded',
          type: 'rh-image',
          position: { x: 0, y: 0 },
          data: {
            label: '角色.png',
            title: '角色',
            sourceObjects: ['https://cdn.example.com/role.png'],
            aspectRatio: '16:9',
            subType: 'text-image',
            width: 480,
            height: 269
          }
        },
        {
          id: 'text',
          type: 'rh-text',
          position: { x: 0, y: 50 },
          data: { label: '独立文本', content: '画布中的文本正文' }
        },
        {
          id: 'image',
          type: 'rh-image',
          position: { x: 100, y: 0 },
          data: {
            label: '图生图',
            subType: 'image-image',
            modelCode: 'image-image-model',
            generateNum: 2,
            prompt: '未采用的草稿',
            params: {
              prompt: '角色身处森林',
              imageUrls: ['https://cdn.example.com/role.png'],
              resolution: '4k',
              aspectRatio: '16:9'
            },
            imageOrder: ['uploaded::https://cdn.example.com/role.png'],
            output: [
              {
                url: 'https://cdn.example.com/result.png',
                originalUrl: 'https://origin.example.com/result.png',
                mediaCategory: 'image',
                success: true
              }
            ]
          }
        },
        {
          id: 'video',
          type: 'rh-video',
          position: { x: 100, y: 100 },
          data: {
            label: '视频',
            subType: 'multimodal-video',
            modelCode: 'multimodal-video-model',
            generateNum: 1,
            params: {
              prompt: '摄影机缓慢后退',
              duration: '15',
              aspectRatio: '16:9',
              resolution: '768p',
              audioMode: 'native',
              refImage1: ''
            },
            output: [
              { url: 'https://cdn.example.com/result.mp4', mediaCategory: 'video', success: true }
            ]
          }
        },
        {
          id: 'audio',
          type: 'rh-audio',
          position: { x: 0, y: 150 },
          data: {
            label: '音乐.mp3',
            sourceObjects: ['https://cdn.example.com/music.mp3'],
            audioUrl: 'https://cdn.example.com/music.mp3',
            subType: 'text-audio'
          }
        },
        {
          id: 'enhance',
          type: 'rh-video',
          position: { x: 200, y: 100 },
          data: {
            label: '视频增强',
            toolsType: 'video-enhance',
            subType: 'video-enhance',
            modelCode: 'video-enhance-model',
            sourceNodeId: 'video',
            toolsSourceUrl: 'https://cdn.example.com/result.mp4',
            params: { videoUrl: 'https://cdn.example.com/result.mp4', enhanceStyle: 'hd' },
            output: [{ url: 'https://cdn.example.com/enhanced.mov', success: true }]
          }
        },
        {
          id: 'reshoot',
          type: 'rh-video',
          position: { x: 200, y: 200 },
          data: {
            label: '片段重拍',
            toolsType: 'video-clip-reshoot',
            subType: 'video-clip-reshoot',
            modelCode: 'video-clip-reshoot-model',
            sourceNodeId: 'video',
            params: {
              prompt: '换成暖色光',
              duration: '-1',
              resolution: 'native1080p',
              generateAudio: true
            },
            clipReshootClips: [{ id: 'clip', startSec: 3, endSec: 8 }],
            output: [{ type: 'video', url: 'https://cdn.example.com/reshoot.mp4' }]
          }
        },
        {
          id: 'vocal',
          type: 'rh-audio',
          position: { x: 300, y: 100 },
          data: {
            label: '人声分离',
            toolsType: 'video-audio',
            subType: 'text-audio',
            modelCode: 'video-audio-model',
            sourceNodeId: 'video',
            params: {
              audioSeparationMode: 'vocal',
              videoUrl: 'https://cdn.example.com/result.mp4'
            },
            output: [
              { url: 'https://cdn.example.com/vocal.flac', mediaCategory: 'audio', success: true }
            ]
          }
        },
        {
          id: 'crop',
          type: 'rh-image',
          position: { x: 300, y: 0 },
          data: {
            label: '裁剪',
            sourceNodeId: 'uploaded',
            sourceObjects: ['https://cdn.example.com/crop.png'],
            width: 476,
            height: 233
          }
        },
        {
          id: 'failed',
          type: 'rh-video',
          position: { x: 300, y: 200 },
          data: {
            label: '失败的去字幕',
            modelCode: 'video-remove-subtitles-model',
            toolsType: 'video-remove-subtitles',
            params: { videoUrl: 'https://cdn.example.com/result.mp4' },
            videoUrl: 'https://cdn.example.com/result.mp4',
            output: [{ url: 'https://cdn.example.com/failed.mov', success: false }]
          }
        }
      ],
      edges: [
        {
          id: 'e1',
          source: 'uploaded',
          target: 'image',
          sourceHandle: 'output',
          targetHandle: 'input'
        },
        { id: 'e2', source: 'image', target: 'video' },
        { id: 'e3', source: 'text', target: 'video' },
        { id: 'e4', source: 'video', target: 'enhance' },
        { id: 'e5', source: 'video', target: 'vocal' }
      ]
    }
  };
};
