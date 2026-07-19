// scroll reveal
const revealEls = document.querySelectorAll('.reveal');
const io = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
  });
}, {threshold:0.15});
revealEls.forEach(el=>io.observe(el));

// hero cursor spotlight (desktop only)
const hero = document.getElementById('heroSection');
const spot = document.getElementById('spotlight');
if(hero && spot && window.matchMedia('(hover:hover)').matches){
  hero.addEventListener('mousemove',(e)=>{
    const r = hero.getBoundingClientRect();
    const x = ((e.clientX - r.left)/r.width*100).toFixed(1)+'%';
    const y = ((e.clientY - r.top)/r.height*100).toFixed(1)+'%';
    spot.style.setProperty('--mx',x);
    spot.style.setProperty('--my',y);
  });
}

// animated stat counter
const counters = document.querySelectorAll('[data-count]');
if(counters.length > 0){
  const cio = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        const counter = e.target;
        if (!counter.dataset.started) {
          counter.dataset.started = 'true';
          const target = parseInt(counter.dataset.count,10);
          const suffix = counter.dataset.suffix || '';
          let cur = 0;
          const step = Math.max(1, Math.round(target/40));
          const tick = ()=>{
            cur = Math.min(target, cur+step);
            counter.textContent = cur+suffix;
            if(cur<target) requestAnimationFrame(tick);
          };
          tick();
          cio.unobserve(counter);
        }
      }
    });
  },{threshold:0.6});
  counters.forEach(c => cio.observe(c));
}

// mobile menu toggle
const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
if (menuToggle && navLinks) {
  menuToggle.addEventListener('click', () => {
    menuToggle.classList.toggle('active');
    navLinks.classList.toggle('active');
  });

  // close menu when clicking a link
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      menuToggle.classList.remove('active');
      navLinks.classList.remove('active');
    });
  });
}
