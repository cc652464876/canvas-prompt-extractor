'use strict';
// Text and reference fields observed on the two supplied platform canvases.
// Account data, cookies and histories are intentionally not captured here.
const imageText =
  '创建一个 4:3 的高端家具提案演示文稿项目，采用 3x4 网格（共 12 帧）的编辑布局，风格对标 Poltrona Frau/B&B Italia，主体请 产品参考图片。结构流程：材质 → 形态 → 比例 → 摆放 → 生活场景闭环。每帧拆分：上方为电影级图像（无文字），下方为项目备注。采用意大利现代主义极简美学，营造家具即雕塑的氛围，体现考究的生活方式。一把置于侧光下的主体是贯穿始终的情感核心。';
const videoText =
  '将提供的 3x4 项目动画化，制作成流畅的电影级视频。\n保持镜头顺序和连贯性。运用缓慢的侧光阴影移动、面料 纹理特写、主体轮廓展现以及室内摆放的航拍漂移效果。\n\n灯光从冷白色的展厅光过渡到温暖的午后侧光阴影。\n呈现家具专题美学，体现雕塑般的克制感与生活化的完美氛围。\n无需新增镜头，无需重新排序，休闲椅始终是所有场景中的情感焦点。';
const jimengText =
  '\u0000rt-md:v1\nv1.1 读取验证：电影质感，柔和侧光。\n\n第二段：保持角色与场景一致。';
function liblib() {
  const imageUrl = 'https://cdn.example.com/grid.png',
    videoUrl = 'https://cdn.example.com/video.mp4',
    referenceUrl = 'https://cdn.example.com/chair.jpg';
  return {
    metadata: {
      platform: 'liblib',
      title: '家具产品宣传广告',
      author: 'Li鱼',
      inputUrl: 'https://www.liblib.tv/detail/94da194049354a42a71b568aec4b64f3'
    },
    snapshot: {
      source: 'react-flow-props',
      frameUrl: 'https://www.liblib.tv/detail/94da194049354a42a71b568aec4b64f3',
      canvasTitle: '家具产品宣传广告',
      nodes: [
        {
          id: 'vkKOAJDhuy',
          type: 'video',
          data: {
            name: '视频节点 5',
            action: 'video_generate',
            url: [videoUrl],
            params: {
              prompt: '',
              model: 'star-video2-fast',
              modeType: 'mixed2video',
              count: 1,
              imageList: [{ nodeId: 'wibgBN2cmT', url: imageUrl }],
              mixedList: [{ nodeId: 'wibgBN2cmT', url: imageUrl, mediaType: 'image' }],
              mixedListOrder: ['wibgBN2cmT'],
              textList: [{ nodeId: 'qxpYr1kQih', content: ['```\n' + videoText + '\n```'] }],
              settings: { ratio: '16:9', resolution: '480p', duration: 10, enableSound: 'on' }
            }
          }
        },
        {
          id: 'qxpYr1kQih',
          type: 'text',
          data: {
            name: '文本节点 2 - 副本',
            content: ['```\n' + videoText + '\n```'],
            action: 'text_resource'
          }
        },
        {
          id: 'wibgBN2cmT',
          type: 'image',
          data: {
            name: '图片节点 4',
            action: 'image_generate',
            url: [imageUrl],
            params: {
              prompt: '',
              model: 'nebula-ultra',
              modeType: 'image2image',
              count: 1,
              settings: { quality: '2K', ratio: '16:9' },
              textList: [{ nodeId: 'IutwBaWOil', content: [imageText] }],
              imageList: [{ nodeId: 'jDfkIX6nEq', url: referenceUrl }]
            }
          }
        },
        {
          id: 'jDfkIX6nEq',
          type: 'image',
          data: { name: '1024', action: 'image_resource', url: [referenceUrl] }
        },
        {
          id: 'IutwBaWOil',
          type: 'text',
          data: { name: '文本节点 2', content: [imageText], action: 'text_resource' }
        }
      ],
      edges: [
        {
          source: 'IutwBaWOil',
          target: 'wibgBN2cmT',
          sourceHandle: 'source',
          targetHandle: 'target'
        },
        { source: 'jDfkIX6nEq', target: 'wibgBN2cmT' },
        { source: 'wibgBN2cmT', target: 'vkKOAJDhuy' },
        { source: 'qxpYr1kQih', target: 'vkKOAJDhuy' }
      ]
    }
  };
}
function jimeng() {
  return {
    metadata: {
      platform: 'jimeng',
      title: '即梦文本引用验证',
      author: '测试',
      inputUrl: 'https://jimeng.jianying.com/ai-tool/ai-canvas/795fb0a4-7d6d-44e1-8c61-f29e4a3fd5dd'
    },
    snapshot: {
      source: 'jimeng-draft-document',
      frameUrl:
        'https://jimeng.jianying.com/ai-tool/ai-canvas/795fb0a4-7d6d-44e1-8c61-f29e4a3fd5dd',
      expectedNodes: 3,
      expectedEdges: 2,
      nodes: [
        {
          id: 'node_zbjqzq5xnn',
          type: 'text',
          data: { title: '文本 1', text: jimengText, tags: [] }
        },
        {
          id: 'node_c42pcgb9bm',
          type: 'image',
          data: {
            title: '图片 1',
            source: 'model_generated',
            generationDraft: {
              kind: 'image',
              parts: [],
              contentSettings: {
                modelName: 'seedream_5.0_lite',
                aspectRatio: '1:1',
                resolution: '2K'
              },
              outputCount: 1,
              references: [
                {
                  slotId: '62d64f13-264b-461b-881b-05d1dd4d32e3',
                  role: 'reference',
                  sourceInstanceId: 'node_zbjqzq5xnn',
                  type: 'extension',
                  extensionType: 'node',
                  nodeId: 'node_zbjqzq5xnn'
                }
              ]
            }
          }
        },
        {
          id: 'node_4nfg55ejxq',
          type: 'video',
          data: {
            title: '视频 1',
            source: 'model_generated',
            generationDraft: {
              kind: 'video',
              parts: [{ type: 'text', text: 'v1.1 视频直接提示词：缓慢推进镜头。' }],
              contentSettings: {
                mode: 'multiModal',
                modelName: 'seedance_2.0_vip',
                aspectRatio: '16:9',
                resolution: '720p',
                durationSeconds: 4,
                isLongVideo: false
              },
              outputCount: 1,
              references: [
                {
                  slotId: 'bbf6c160-d90d-4340-aef7-4e38dfc477de',
                  role: 'reference',
                  sourceInstanceId: 'node_zbjqzq5xnn',
                  type: 'extension',
                  extensionType: 'node',
                  nodeId: 'node_zbjqzq5xnn'
                }
              ]
            }
          }
        }
      ],
      edges: [
        { source: 'node_zbjqzq5xnn', target: 'node_c42pcgb9bm', type: 'reference' },
        { source: 'node_zbjqzq5xnn', target: 'node_4nfg55ejxq', type: 'reference' }
      ]
    }
  };
}
module.exports = { liblib, jimeng, imageText, videoText, jimengText };
