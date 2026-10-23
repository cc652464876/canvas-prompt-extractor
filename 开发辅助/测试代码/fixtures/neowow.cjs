'use strict';
// Synthetic content matching fields observed in NeoWow's production Vue Flow.
module.exports = () => ({
  metadata: {
    platform: 'neowow',
    title: '合成公开画布',
    author: '合成作者',
    inputUrl: 'https://neowow.cn/video-works-view?id=fixture'
  },
  snapshot: {
    nodes: [
      { id: 'group', type: 'group', data: { label: '场景一' } },
      {
        id: 'text',
        type: 'text',
        parentNode: 'group',
        data: { label: '文本生成', result: '当前正文', prompt: '旧的文本生成输入' }
      },
      {
        id: 'upload',
        type: 'image',
        data: {
          label: '角色',
          type: 'upload',
          inputImageUrls: ['https://neoai-online.neodomain.cn/fixture/character.png']
        }
      },
      {
        id: 'image',
        type: 'image',
        parentNode: 'group',
        data: {
          label: '图片生成',
          type: 'generation',
          prompt: 'image 1 进入森林',
          modelName: 'Neo Image',
          connectedImageUrls: ['https://neoai-online.neodomain.cn/fixture/character.png'],
          connectedSourceMap: {
            'https://neoai-online.neodomain.cn/fixture/character.png': 'upload'
          },
          inputTexts: [{ nodeId: 'text', text: '参数中的正文' }],
          inputImageUrls: ['https://neoai-online.neodomain.cn/fixture/result.png'],
          result: { imageUrl: 'https://cdn.example.com/stale.png' },
          width: 1600,
          height: 900
        }
      },
      {
        id: 'video',
        type: 'video',
        data: {
          label: '视频生成',
          type: 'generation',
          prompt: 'image 1 开始行走',
          modelName: 'Seedance 2.5',
          universalModel: 'neo-video',
          duration: '4',
          resolution: '480p',
          aspectRatio: '16:9',
          universalDuration: '15',
          universalResolution: '1080p',
          universalAspectRatio: '21:9',
          connectedImageUrls: ['https://neoai-online.neodomain.cn/fixture/result.png'],
          connectedAudioUrls: ['https://neoai-online.neodomain.cn/fixture/voice.wav'],
          manualReferences: [
            { type: 'image', url: 'https://cdn.example.com/manual.png', name: '手动参考' }
          ],
          referenceDisplayOrder: {
            image: [
              'https://cdn.example.com/manual.png',
              'https://neoai-online.neodomain.cn/fixture/result.png',
              'https://cdn.example.com/removed.png'
            ]
          },
          inputTexts: ['参数文本快照'],
          inputVideoUrls: ['https://neoai-online.neodomain.cn/fixture/video.mp4']
        }
      },
      {
        id: 'audio',
        type: 'audio',
        data: {
          label: '音频生成',
          type: 'generation',
          prompt: '旧音频提示词',
          seedAudioPrompt: '实际语音提示词',
          seedAudioConfig: { sampleRate: 24000 },
          inputAudioUrls: ['https://neoai-online.neodomain.cn/fixture/voice.wav']
        }
      },
      {
        id: 'upload-audio',
        type: 'audio',
        data: {
          label: '背景音频',
          type: 'upload',
          inputAudioUrls: [['https://neoai-online.neodomain.cn/fixture/music.mp3']]
        }
      },
      {
        id: 'composition',
        type: 'videoComposition',
        data: {
          label: '视频合成',
          type: 'composition',
          videoInputs: [
            { sourceNodeId: 'video', url: 'https://neoai-online.neodomain.cn/fixture/video.mp4' }
          ],
          result: { videoUrl: 'https://neoai-online.neodomain.cn/fixture/composed.mp4' }
        }
      },
      {
        id: 'derived',
        type: 'video',
        data: {
          label: '压缩视频',
          type: 'generated',
          sourceNodeId: 'video',
          source: 'video_compress',
          inputVideoUrls: ['https://neoai-online.neodomain.cn/fixture/compressed.mp4']
        }
      },
      {
        id: 'media',
        type: 'mediaInput',
        data: {
          label: '媒体输入',
          mediaType: 'image',
          mediaUrl: 'https://cdn.example.com/media.png'
        }
      }
    ],
    edges: [
      { id: 'e1', source: 'text', target: 'image' },
      { id: 'e2', source: 'upload', target: 'image' },
      { id: 'e3', source: 'image', target: 'video' },
      { id: 'e4', source: 'video', target: 'composition' }
    ]
  }
});
