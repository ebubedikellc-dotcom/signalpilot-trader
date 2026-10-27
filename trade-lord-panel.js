// Small owner-panel entry point. Trade Lord has its own dedicated interface.
const trainingForm=document.querySelector('#tradeLordLesson');
if(trainingForm)trainingForm.addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter,status=document.querySelector('#tradeLordSaveStatus');
  button.disabled=true;status.textContent='Saving lesson…';
  try{
    const values=Object.fromEntries(new FormData(trainingForm));values.rightsConfirmed=values.rightsConfirmed==='on';
    const response=await fetch('/api/trade-lord/knowledge',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save. Please try again.');
    trainingForm.reset();status.textContent='Saved ✓ Trade Lord can now use this lesson. Open the training room to see it.';
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});
