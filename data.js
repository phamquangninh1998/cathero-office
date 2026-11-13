// Office roster. Edit this file to hire people or move desks.
// Which seats hold an employee (a Claude thread) is NOT in this public file:
// thread ids live in Firestore (office/roster), readable only by the owner account.
// App icons (appIcon: true) also come from Firestore (office/icons), not this public repo.
window.OFFICE_DATA = {
  studio: "Cat Hero Studio",
  projectUrl: "https://claude.ai/code/project/chan_01KHZZY2Zsyqn7jE4CfbzvCK",

  boss: {
    name: "Anh Ninh",
    title: "CEO",
    look: { skin: "#f6cfa8", hair: "#2b2230", hairStyle: "short", shirt: "#e8505b", glasses: true, mug: "#ffd36e" }
  },

  roles: {
    developer: {
      label: "Developer",
      desc: "Viết code, sửa lỗi, build bản test và bản phát hành.",
      shirt: "#4f7cff", prop: "plant",
      templates: [
        "Build bản test mới nhất và gửi APK lên Telegram.",
        "Sửa lỗi: ",
        "Liệt kê các lỗi đã biết và đề xuất thứ tự sửa."
      ]
    },
    designer: {
      label: "Designer",
      desc: "Thiết kế gameplay, level, độ khó và luồng chơi.",
      shirt: "#b46cf0", prop: "pencils",
      templates: [
        "Đề xuất 3 ý tưởng level mới.",
        "Cân bằng lại độ khó của màn ",
        "Viết tài liệu thiết kế cho tính năng "
      ]
    },
    artist: {
      label: "Artist",
      desc: "Vẽ nhân vật, môi trường, icon và ảnh cho store.",
      shirt: "#ff9f43", prop: "palette",
      templates: [
        "Vẽ lại icon app cho dễ thương và nổi bật hơn.",
        "Làm bộ ảnh chụp màn hình mới cho store.",
        "Đề xuất bảng màu mới cho "
      ]
    },
    marketing: {
      label: "Marketing",
      desc: "Chạy quảng cáo, làm video, theo dõi chiến dịch.",
      shirt: "#ff5e7e", prop: "megaphone",
      templates: [
        "Báo cáo hiệu quả quảng cáo 7 ngày qua.",
        "Làm video quảng cáo 15 giây cho ",
        "Đề xuất ngân sách quảng cáo tuần tới."
      ]
    },
    data: {
      label: "Data Analyst",
      desc: "Đọc số liệu Analytics, AdMob, store và rút ra kết luận.",
      shirt: "#1fb5a3", prop: "chart", glasses: true,
      templates: [
        "Phân tích retention D1 và D7 của các bản game.",
        "Người chơi bỏ cuộc nhiều nhất ở màn nào?",
        "So sánh doanh thu quảng cáo giữa các bản."
      ]
    },
    release: {
      label: "Release Manager",
      desc: "Chuẩn bị và nộp bản phát hành lên App Store và Google Play.",
      shirt: "#2fbf71", prop: "rocket",
      templates: [
        "Kiểm tra trạng thái review trên hai store.",
        "Chuẩn bị bản phát hành mới cho ",
        "Liệt kê các việc còn thiếu trước khi phát hành."
      ]
    },
    sound: {
      label: "Sound Designer",
      desc: "Làm nhạc nền và hiệu ứng âm thanh.",
      shirt: "#7a5cff", prop: "notes", headphones: true,
      templates: [
        "Làm nhạc nền vui nhộn cho ",
        "Thêm hiệu ứng âm thanh khi ",
        "Rà lại âm lượng các hiệu ứng cho đều nhau."
      ]
    },
    idea: {
      label: "Idea maker",
      desc: "Nghĩ ý tưởng game mới, tính năng mới, cách tăng doanh thu và marketing cho cả studio.",
      shirt: "#fab005", prop: "pencils",
      templates: [
        "Đề xuất 5 ý tưởng game mới đang trend, có thể làm nhanh.",
        "Ý tưởng tính năng mới cho ",
        "Ý tưởng tăng doanh thu quảng cáo cho các game đang có."
      ]
    },
    qa: {
      label: "QA",
      desc: "Chơi thử, tìm lỗi và kiểm tra lỗi đã sửa.",
      shirt: "#f5c33b", prop: "magnifier",
      templates: [
        "Chơi thử bản mới nhất và liệt kê lỗi.",
        "Kiểm tra lại lỗi này đã sửa chưa: ",
        "Viết danh sách kiểm tra trước khi phát hành."
      ]
    }
  },

  common: [
    "Báo cáo tiến độ: đã xong gì, đang làm gì, đang chờ gì.",
    "Tóm tắt việc hôm nay trong 3 dòng."
  ],

  teams: [
    {
      id: "b1", appIcon: true, name: "Bản 1", game: "Dọn dẹp", project: "Cat Hero Spacecraft",
      color: "#6ec6ff", icon: "broom",
      seats: [
        { role: "developer" },
        { role: "designer" },
        { role: "artist" }
      ]
    },
    {
      id: "b2", appIcon: true, name: "Bản 2", game: "Bắn phá", project: "Cat Hero Invaders",
      color: "#ff8a80", icon: "blaster",
      seats: [
        { role: "developer" },
        { role: "designer" },
        { role: "artist" }
      ]
    },
    {
      id: "b3", appIcon: true, name: "Bản 3", game: "Thả lính", project: "Cat Hero Animal Soldiers",
      color: "#9be38f", icon: "parachute",
      seats: [
        { role: "developer" },
        { role: "designer" },
        { role: "artist" }
      ]
    },
    {
      id: "b4", appIcon: true, name: "Bản 4", game: "Solo", project: "Cat Hero Solo Play",
      color: "#ffd166", icon: "star",
      seats: [
        { role: "developer" },
        { role: "designer" },
        { role: "artist" }
      ]
    },
    {
      id: "sports", appIcon: true, name: "100 Sports", game: "Chạy thể thao", project: "100 Sports",
      color: "#74c0fc", icon: "star",
      seats: [ { role: "developer" }, { role: "designer" }, { role: "artist" } ]
    },
    {
      id: "moe", appIcon: true, name: "Moe Family", game: "Only Up", project: "Moe Family Only Up",
      color: "#ffa8a8", icon: "star",
      seats: [ { role: "developer" }, { role: "designer" }, { role: "artist" } ]
    },
    {
      id: "paperroll", appIcon: true, name: "Paper Roll", game: "Lazy Cat", project: "Paper Roll: Lazy Cat",
      color: "#63e6be", icon: "star",
      seats: [ { role: "developer" }, { role: "designer" }, { role: "artist" } ]
    },
    {
      // Sits in the centre, right under the CEO desk (not a team zone).
      id: "idea", center: true, name: "Idea maker", game: "Ý tưởng", project: "Cả studio",
      color: "#ffd43b", icon: "star",
      seats: [ { role: "idea" } ]
    },
    {
      id: "chung", name: "Chung", game: "Dùng chung", project: "Cả 7 game",
      color: "#c3a6ff", icon: "globe", shared: true,
      seats: [
        { role: "marketing" },
        { role: "data" },
        { role: "release" },
        { role: "sound" },
        { role: "qa" }
      ]
    }
  ]
};
