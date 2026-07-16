<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();
</script>

<main class="auth-split-page">
  <section class="auth-form-pane" aria-label="계정 진입">
    <a class="auth-split-brand" href="/" aria-label="아트브릿지 메인으로 이동">
      <span class="brand-mark">A</span>
      <strong>아트브릿지</strong>
    </a>

    <div class="auth-panel-slot">
      {@render children()}
    </div>

    <p class="auth-footnote">초대받은 계정은 로그인 후 바로 공연 작업공간에 연결됩니다.</p>
  </section>

  <aside class="auth-preview-pane" aria-label="아트브릿지 작업 흐름 미리보기">
    <div class="auth-preview-copy">
      <span class="badge">대본 · 음악 큐 · 일정 · 체크리스트</span>
      <h2>각자 필요한 화면만 보고 리딩을 진행합니다.</h2>
      <p>관리자는 공연과 멤버를 관리하고, 배우와 스태프는 내 장면, 담당 큐, 출석과 체크리스트를 확인합니다.</p>
    </div>

    <div class="auth-preview-board">
      <div class="auth-preview-topbar">
        <span>오늘의 리딩</span>
        <strong>Act 1 · 1장</strong>
        <em>13:00</em>
      </div>

      <div class="auth-preview-grid">
        <div class="auth-preview-side">
          <span class="is-active">내 장면</span>
          <span>대본</span>
          <span>큐</span>
          <span>체크</span>
        </div>

        <div class="auth-preview-main">
          <div class="auth-script-line">
            <span>대본 블록</span>
            <strong>민준: 오늘은 여기서 시작할게요.</strong>
            <small>내 대사 · 공유 주석 · cue anchor</small>
          </div>
          <div class="auth-cue-line">
            <span>M01 CUE</span>
            <strong>인트로 음악 00:12</strong>
            <small>fade in 2s · volume -3dB</small>
          </div>
          <div class="auth-run-line">
            <span>진행표</span>
            <strong>출석 8/11 · 체크 6/9</strong>
            <small>무대감독 확인 대기 2건</small>
          </div>
        </div>
      </div>

      <div class="auth-role-pills" aria-label="역할별 업무">
        <span>기획자</span>
        <span>연출자</span>
        <span>음악감독</span>
        <span>배우·스태프</span>
      </div>
    </div>
  </aside>
</main>
